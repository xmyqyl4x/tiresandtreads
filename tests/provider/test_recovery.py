"""Pinned local fixture provider: real HTTP, process death and exact-state recovery."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.request

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError


class ProviderRecovery(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="tt-provider-test-")
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            self.port = sock.getsockname()[1]
        self.process = None
        self.logs = tempfile.TemporaryFile()
        self.start()
        options = dict(endpoint_url=f"http://127.0.0.1:{self.port}", region_name="us-east-1",
                       aws_access_key_id="fixture-access", aws_secret_access_key="fixture-secret",
                       config=Config(retries={"max_attempts": 0}, connect_timeout=2, read_timeout=3))
        self.s3 = boto3.client("s3", **options)
        self.kms = boto3.client("kms", **options)

    def start(self, ready=True):
        env = dict(os.environ, PROVIDER_STATE_DIRECTORY=self.directory.name, MOTO_PORT=str(self.port), PROVIDER_BIND_ADDRESS="127.0.0.1")
        self.process = subprocess.Popen(["python", "/provider/server.py"], env=env,
                                        stdout=self.logs, stderr=self.logs)
        if ready:
            for _ in range(100):
                try:
                    urllib.request.urlopen(f"http://127.0.0.1:{self.port}/moto-api/", timeout=.2)
                    return
                except Exception as error:
                    last_error = type(error).__name__+": "+str(error)
                    if self.process.poll() is not None:
                        break
                    time.sleep(.05)
            self.logs.seek(0)
            self.fail("Provider did not become ready: "+last_error+" "+self.logs.read().decode("utf-8")[:1000])

    def kill(self):
        if self.process and self.process.poll() is None:
            self.process.send_signal(signal.SIGKILL)
            self.process.wait(timeout=5)

    def tearDown(self):
        self.kill()
        from state import restore
        restore([])
        self.s3.close()
        self.kms.close()
        self.logs.close()
        self.directory.cleanup()

    def seed(self):
        arn = self.kms.create_key(Description="Synthetic recovery fixture")["KeyMetadata"]["Arn"]
        cipher = self.kms.encrypt(KeyId=arn, Plaintext=b"synthetic canary", EncryptionContext={"scope":"fixture"})["CiphertextBlob"]
        self.s3.create_bucket(Bucket="fixture-recovery")
        self.s3.put_bucket_versioning(Bucket="fixture-recovery", VersioningConfiguration={"Status":"Enabled"})
        versions = []
        for value in [b"first version", b"second version"]:
            versions.append(self.s3.put_object(Bucket="fixture-recovery", Key="private/report", Body=value,
                Metadata={"fixture":"true"}, ServerSideEncryption="aws:kms", SSEKMSKeyId=arn)["VersionId"])
        deleted = self.s3.delete_object(Bucket="fixture-recovery", Key="private/report")["VersionId"]
        return arn, cipher, versions, deleted

    def test_acknowledged_keys_ciphertext_versions_and_delete_markers_survive_sigkill(self):
        arn, cipher, versions, deleted = self.seed()
        before = self.s3.list_object_versions(Bucket="fixture-recovery")
        for _ in range(2):
            self.kill()
            self.start()
            self.assertEqual(self.kms.decrypt(KeyId=arn, CiphertextBlob=cipher, EncryptionContext={"scope":"fixture"})["Plaintext"], b"synthetic canary")
            for version, value in zip(versions, [b"first version", b"second version"]):
                obj = self.s3.get_object(Bucket="fixture-recovery", Key="private/report", VersionId=version)
                self.assertEqual(obj["Body"].read(), value)
                self.assertEqual(obj["Metadata"], {"fixture":"true"})
                self.assertEqual(obj["SSEKMSKeyId"], arn)
            after = self.s3.list_object_versions(Bucket="fixture-recovery")
            self.assertEqual(after["Versions"], before["Versions"])
            self.assertEqual(after["DeleteMarkers"], before["DeleteMarkers"])
            self.assertEqual(after["DeleteMarkers"][0]["VersionId"], deleted)
            with self.assertRaises(ClientError):
                self.s3.get_object(Bucket="fixture-recovery", Key="private/report")

    def test_corrupt_or_missing_checkpoint_refuses_start_without_replacing_custody(self):
        self.seed()
        self.kill()
        key = Path(self.directory.name, "auth.key").read_bytes()
        checkpoint = Path(self.directory.name, "state.json")
        checkpoint.write_bytes(checkpoint.read_bytes()[:-10]+b"corrupted!")
        self.start(ready=False)
        self.assertEqual(self.process.wait(timeout=5), 1)
        self.assertEqual(Path(self.directory.name,"auth.key").read_bytes(), key)
        checkpoint.unlink()
        self.start(ready=False)
        self.assertEqual(self.process.wait(timeout=5), 1)
        self.assertEqual(Path(self.directory.name,"auth.key").read_bytes(), key)

    def test_snapshot_codec_rejects_executable_unknown_or_oversized_state(self):
        from state import encode, decode
        with self.assertRaises(ValueError):
            encode(object())
        with self.assertRaises(ValueError):
            decode({"type":"os.system", "state":"untrusted"})
        with self.assertRaises(ValueError):
            decode({"type":"bytes", "value":"not base64!"})
        self.assertEqual(decode(encode({"x":b"fixture", "y":(1,2)})), {"x":b"fixture", "y":(1,2)})

    def test_checkpoint_failure_withholds_ack_and_poisoned_memory_until_verified_restart(self):
        self.seed()
        self.kill()
        from state import Store
        from server import Provider
        from moto.kms.models import kms_backends
        from werkzeug.test import Client
        store = Store(self.directory.name,"fixture-test")
        previous = Path(self.directory.name,"state.json").read_bytes()
        provider = Provider(store)
        def mutate(environ,start):
            kms_backends["123456789012"]["us-east-1"].create_key(policy=None,key_usage="ENCRYPT_DECRYPT",key_spec="SYMMETRIC_DEFAULT",description="unacknowledged",tags=[])
            start("200 OK",[])
            return [b"not acknowledged"]
        def fail():
            raise OSError("synthetic disk failure")
        provider.app, store.save = mutate, fail
        client = Client(provider)
        self.assertEqual(client.post("/fixture",data=b"fixture").status_code,503)
        self.assertEqual(client.get("/moto-api/").status_code,503)
        self.assertEqual(Path(self.directory.name,"state.json").read_bytes(),previous)
        Store(self.directory.name,"fixture-test")
        self.assertEqual(len(kms_backends["123456789012"]["us-east-1"].keys),1)

    def test_wrong_scope_key_permissions_and_capacity_refuse_without_replacing_state(self):
        self.seed()
        self.kill()
        from state import Store
        checkpoint = Path(self.directory.name,"state.json")
        previous = checkpoint.read_bytes()
        with self.assertRaises(ValueError):
            Store(self.directory.name,"tt-dev")
        key = Path(self.directory.name,"auth.key")
        original = key.read_bytes()
        key.write_bytes(os.urandom(32))
        with self.assertRaises(ValueError):
            Store(self.directory.name,"fixture-test")
        key.write_bytes(original)
        checkpoint.chmod(0o644)
        with self.assertRaises(ValueError):
            Store(self.directory.name,"fixture-test")
        checkpoint.chmod(0o600)
        store = Store(self.directory.name,"fixture-test")
        store.maximum = 100
        with self.assertRaises(ValueError):
            store.save()
        self.assertEqual(checkpoint.read_bytes(),previous)

    def test_lost_ack_after_checkpoint_retains_unknown_committed_effect_for_reconciliation(self):
        self.seed()
        self.kill()
        from state import Store
        from server import Provider
        from moto.kms.models import kms_backends
        from werkzeug.test import Client
        store = Store(self.directory.name,"fixture-test")
        provider = Provider(store)
        save = store.save
        def mutate(environ,start):
            kms_backends["123456789012"]["us-east-1"].create_key(policy=None,key_usage="ENCRYPT_DECRYPT",key_spec="SYMMETRIC_DEFAULT",description="unknown commit",tags=[])
            start("200 OK",[])
            return [b"not acknowledged"]
        def lose_ack():
            save()
            raise OSError("synthetic acknowledgement loss")
        provider.app, store.save = mutate, lose_ack
        self.assertEqual(Client(provider).post("/fixture",data=b"fixture").status_code,503)
        Store(self.directory.name,"fixture-test")
        self.assertEqual(len(kms_backends["123456789012"]["us-east-1"].keys),2)


if __name__ == "__main__":
    unittest.main()
