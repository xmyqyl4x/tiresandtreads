"""Bounded, non-executable snapshots for the pinned Moto fixture, never AWS key export."""
import base64
from datetime import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import stat

import moto
from moto.s3 import models as s3
from moto.kms import models as kms
from moto.utilities.tagging_service import TaggingService
from moto.kms.utils import RSAPrivateKey as MotoRsaKey
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

CLASSES = {c.__name__: c for c in [s3.FakeBucket, s3.FakeKey, s3.FakeDeleteMarker,
    s3.FakeAcl, s3.FakeGrant, s3.FakeGrantee, kms.Key, kms.Alias, kms.Grant, TaggingService, MotoRsaKey]}
DICTS = {c.__name__: c for c in [dict, s3._VersionedKeyStore, s3.MultipartDict, s3.LowercaseDict]}


def encode(value, depth=0):
    if depth > 40:
        raise ValueError("Snapshot depth")
    child = lambda v: encode(v, depth+1)
    if value is None or type(value) in [str, int, float, bool]:
        return value
    if isinstance(value, bytes):
        return {"type":"bytes", "value":base64.b64encode(value).decode("ascii")}
    if isinstance(value, datetime):
        return {"type":"datetime", "value":value.isoformat()}
    if type(value) in [list, tuple]:
        return {"type":type(value).__name__, "value":[child(v) for v in value]}
    if type(value) in DICTS.values():
        items = value.lists() if isinstance(value, s3._VersionedKeyStore) else value.items()
        return {"type":type(value).__name__, "value":[[child(k),child(v)] for k,v in items]}
    if isinstance(value, rsa.RSAPrivateKey):
        data = value.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
        return {"type":"rsa", "value":base64.b64encode(data).decode("ascii")}
    if type(value) in CLASSES.values():
        if isinstance(value,s3.FakeKey) and value.contentsize > 16*1024*1024:
            raise ValueError("Fixture object capacity exceeded")
        fields = value.__getstate__() if isinstance(value,s3.FakeKey) else vars(value)
        return {"type":type(value).__name__, "value":child(fields)}
    raise ValueError("Unsupported fixture resource; no partial snapshot")


def decode(value, depth=0):
    if depth > 40:
        raise ValueError("Snapshot depth")
    if value is None or type(value) in [str,int,float,bool]:
        return value
    if type(value) is not dict or set(value) != {"type","value"}:
        raise ValueError("Invalid snapshot node")
    kind, data = value["type"], value["value"]
    child = lambda v: decode(v,depth+1)
    if kind == "bytes":
        return base64.b64decode(data,validate=True)
    if kind == "datetime":
        return datetime.fromisoformat(data)
    if kind == "rsa":
        key = serialization.load_der_private_key(base64.b64decode(data,validate=True), password=None)
        if not isinstance(key,rsa.RSAPrivateKey):
            raise ValueError("Unsupported fixture key")
        return key
    if kind in ["list","tuple"]:
        result = [child(v) for v in data]
        return tuple(result) if kind == "tuple" else result
    if kind in DICTS:
        result = DICTS[kind]()
        for k,v in data:
            if kind == "_VersionedKeyStore":
                dict.__setitem__(result,child(k),child(v))
            else:
                result[child(k)] = child(v)
        return result
    if kind in CLASSES:
        fields = child(data)
        if type(fields) is not dict or any(not isinstance(k,str) or k.startswith("__") for k in fields):
            raise ValueError("Invalid fixture fields")
        result = object.__new__(CLASSES[kind])
        if kind == "FakeKey":
            result.__setstate__(fields)
        else:
            result.__dict__.update(fields)
        return result
    raise ValueError("Unknown snapshot type")


def capture():
    result = []
    for service, backends in [("s3",s3.s3_backends),("kms",kms.kms_backends)]:
        for account, regions in backends.items():
            for region, backend in regions.items():
                if service == "s3":
                    if backend.table_buckets or backend.inventory_configs or any(b.multiparts for b in backend.buckets.values()):
                        raise ValueError("Unsupported fixture resource")
                    state = {"buckets":backend.buckets,"tagger":backend.tagger,"_pagination_tokens":backend._pagination_tokens}
                else:
                    state = {"keys":backend.keys,"tagger":backend.tagger}
                result.append([service,account,region,encode(state)])
    return result


def restore(records):
    # Decode/validate everything before changing the live registry. Never execute a module/name from JSON.
    decoded = []
    for service,account,region,body in records:
        if service not in ["s3","kms"] or not isinstance(account,str) or not isinstance(region,str):
            raise ValueError("Invalid fixture registry")
        state = decode(body)
        if set(state) != ({"buckets","tagger","_pagination_tokens"} if service=="s3" else {"keys","tagger"}):
            raise ValueError("Invalid backend fields")
        decoded.append((service,account,region,state))
    for regions in s3.s3_backends.values():
        for backend in regions.values():
            for bucket in backend.buckets.values():
                for versions in dict.values(bucket.keys):
                    for key in versions:
                        if isinstance(key,s3.FakeKey) and not key.disposed:
                            key.dispose()
    s3.s3_backends.clear()
    kms.kms_backends.clear()
    s3.s3_backends.bucket_accounts.clear()
    for service,account,region,state in decoded:
        backend = (s3.s3_backends if service=="s3" else kms.kms_backends)[account][region]
        backend.__dict__.update(state)
        if service == "s3":
            for bucket in backend.buckets.values():
                s3.s3_backends.bucket_accounts[bucket.name] = (bucket.partition,account)


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),allow_nan=False).encode("utf-8")


class Store:
    def __init__(self,directory,scope):
        if moto.__version__ != "5.1.23.dev" or not Path(directory).is_absolute():
            raise ValueError("Pinned local provider required")
        self.directory, self.scope = Path(directory), scope
        self.directory.mkdir(mode=0o700,parents=True,exist_ok=True)
        if self.directory.stat().st_mode & 0o077:
            raise ValueError("Private provider directory required")
        self.key_path, self.path = self.directory/"auth.key", self.directory/"state.json"
        self.maximum = 64*1024*1024
        self.sequence = 0
        if self.key_path.exists():
            self.key = self.private_read(self.key_path,32)
            if len(self.key)!=32:
                raise ValueError("Invalid fixture custody")
            self.load()
        else:
            if any(self.directory.iterdir()):
                raise ValueError("Missing fixture custody")
            self.key = os.urandom(32)
            with open(self.key_path,"xb") as out:
                os.chmod(self.key_path,0o600)
                out.write(self.key); out.flush(); os.fsync(out.fileno())
            self.save()

    @staticmethod
    def private_read(path,maximum):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_size>maximum or info.st_mode & 0o077:
            raise ValueError("Invalid private fixture snapshot")
        return path.read_bytes()

    def load(self):
        envelope = json.loads(self.private_read(self.path,self.maximum))
        if set(envelope)!={"body","mac"}:
            raise ValueError("Invalid fixture snapshot")
        body = envelope["body"]
        expected = hmac.new(self.key,canonical(body),hashlib.sha256).hexdigest()
        if not hmac.compare_digest(envelope["mac"],expected) or body["scope"]!=self.scope or body["moto"]!="5.1.23.dev" or body["version"]!=1:
            raise ValueError("Fixture snapshot verification failed")
        if type(body["sequence"]) is not int or body["sequence"]<1:
            raise ValueError("Invalid fixture sequence")
        restore(body["state"])
        self.sequence = body["sequence"]

    def save(self):
        body = {"version":1,"moto":"5.1.23.dev","scope":self.scope,"sequence":self.sequence+1,"state":capture()}
        data = canonical({"body":body,"mac":hmac.new(self.key,canonical(body),hashlib.sha256).hexdigest()})
        if len(data)>self.maximum:
            raise ValueError("Fixture snapshot capacity exceeded")
        temporary = self.directory/"state.pending"
        with open(temporary,"wb") as out:
            os.chmod(temporary,0o600)
            out.write(data); out.flush(); os.fsync(out.fileno())
        os.replace(temporary,self.path)
        fd = os.open(self.directory,os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        self.sequence += 1
