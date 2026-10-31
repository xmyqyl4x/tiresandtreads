"""Owned synthetic per-run material; never print keys/PEM or reuse retained files."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import os
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa

now=datetime.now(timezone.utc)
def authority(label):
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,label)])
    cert=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=2)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(key,hashes.SHA256()))
    return key,cert
root_key,root=authority('Synthetic admission root')
_,wrong=authority('Synthetic unrelated root')
trust=Path('/trust');trust.mkdir(exist_ok=True)
if any(trust.iterdir()):raise RuntimeError('Refusing existing admission material')
for name,cert in [('ca.crt',root),('wrong-ca.crt',wrong)]:
    (trust/name).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
for directory,host in [(Path('/source'),'postgres.preflight.test'),(Path('/target'),'recovery-postgres.preflight.test')]:
    directory.mkdir(exist_ok=True)
    if any(directory.iterdir()):raise RuntimeError('Refusing existing admission keys')
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    for variant,before,after in [('valid',now-timedelta(days=1),now+timedelta(days=1)),('expired',now-timedelta(days=2),now-timedelta(days=1)),('future',now+timedelta(days=1),now+timedelta(days=2))]:
        cert=(x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,host)])).issuer_name(root.subject).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(before).not_valid_after(after).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.DNSName(host)]),critical=False).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]),critical=False).sign(root_key,hashes.SHA256()))
        (directory/f'server.{variant}.crt').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    path=directory/'server.key';path.write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));os.chown(path,999,999);os.chmod(path,0o600)
print('Created distinct ephemeral admission leaf keys and bounded public trust material')
