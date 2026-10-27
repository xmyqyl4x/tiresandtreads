"""Ephemeral synthetic TLS fixtures; no key or certificate bytes enter Git/logs."""
from pathlib import Path
from datetime import datetime, timedelta, timezone
import os
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa, padding

directory = Path('/tls')
directory.mkdir(exist_ok=True)
names = {'ca.crt', 'wrong-ca.crt', 'server.crt', 'expired.crt', 'server.key'}
if any(directory.iterdir()):
    if {p.name for p in directory.iterdir()} != names:
        raise RuntimeError('Unexpected fixture custody')
    ca = x509.load_pem_x509_certificate((directory / 'ca.crt').read_bytes())
    key = serialization.load_pem_private_key((directory / 'server.key').read_bytes(), None)
    for name in ['server.crt', 'expired.crt']:
        cert = x509.load_pem_x509_certificate((directory / name).read_bytes())
        ca.public_key().verify(cert.signature, cert.tbs_certificate_bytes, padding.PKCS1v15(), cert.signature_hash_algorithm)
        if cert.public_key().public_numbers() != key.public_key().public_numbers():
            raise RuntimeError('Fixture key mismatch')
    print('Existing ephemeral TLS custody verified')
else:
    now = datetime.now(timezone.utc)
    def authority(label):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, label)])
        cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                .public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=1)).not_valid_after(now + timedelta(days=3))
                .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
                .sign(key, hashes.SHA256()))
        return key, cert
    ca_key, ca = authority('Synthetic local preflight root')
    _, wrong_ca = authority('Synthetic unrelated root')
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    def server(expired):
        return (x509.CertificateBuilder()
                .subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'postgres.preflight.test')]))
                .issuer_name(ca.subject).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now - timedelta(days=2 if expired else 1))
                .not_valid_after(now - timedelta(days=1) if expired else now + timedelta(days=2))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.SubjectAlternativeName([x509.DNSName('postgres.preflight.test')]), critical=False)
                .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                .sign(ca_key, hashes.SHA256()))
    for name, cert in [('ca.crt', ca), ('wrong-ca.crt', wrong_ca), ('server.crt', server(False)), ('expired.crt', server(True))]:
        (directory / name).write_bytes(cert.public_bytes(serialization.Encoding.PEM))
        os.chmod(directory / name, 0o644)
    path = directory / 'server.key'
    path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chown(path, 999, 999)
    os.chmod(path, 0o600)
    print('Created ephemeral local TLS fixture material')
