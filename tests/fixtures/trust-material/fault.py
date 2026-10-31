"""Fixed parent-only synthetic file fault, no network, owner credentials or SQL.

PostgreSQL already loaded the original valid key/leaf before this control runs.
These are custody refusals, not server restart or handshake mismatch claims.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import json
import os
from cryptography import x509
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa

profile = os.environ.get('LR01_PROFILE')
if profile not in ('missing-root', 'missing-leaf', 'extra-file', 'mixed-leaf', 'wrong-key-pair'):
    raise RuntimeError('Fixed material profile refused')

def names(path):
    return sorted(p.name for p in Path(path).iterdir())

assert names('/trust') == ['ca.crt', 'wrong-ca.crt']
for path in ('/source', '/target'):
    assert names(path) == ['server.expired.crt', 'server.future.crt', 'server.key', 'server.valid.crt']
    for p in Path(path).iterdir():
        assert p.is_file() and not p.is_symlink() and 0 < p.stat().st_size <= 65536

root = x509.load_pem_x509_certificate(Path('/trust/ca.crt').read_bytes())
assert root.extensions.get_extension_for_class(x509.BasicConstraints).value.ca
leaf_path = Path('/source/server.valid.crt')
key_path = Path('/source/server.key')
leaf = x509.load_pem_x509_certificate(leaf_path.read_bytes())
key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
leaf.verify_directly_issued_by(root)
assert leaf.public_key().public_numbers() == key.public_key().public_numbers()
assert key_path.stat().st_uid == 999 and key_path.stat().st_mode & 0o777 == 0o600

witness = dict(profile=profile, fixedSyntheticFileChanges=1, sqlDispatches=0, providerDispatches=0)
if profile == 'missing-root':
    Path('/trust/ca.crt').unlink()
    assert not Path('/trust/ca.crt').exists()
    witness['rootAbsent'] = True
elif profile == 'missing-leaf':
    leaf_path.unlink()
    assert not leaf_path.exists()
    witness['sourceLeafAbsent'] = True
elif profile == 'extra-file':
    Path('/trust/unexpected.fixture').write_text('fixed owned synthetic extra material\n')
    assert names('/trust') == ['ca.crt', 'unexpected.fixture', 'wrong-ca.crt']
    witness['unexpectedTrustEntry'] = True
elif profile == 'mixed-leaf':
    # Preserve the correct hostname, valid dates and existing key. Only issuance
    # comes from another in-memory generation, isolating mixed issuer material.
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Other synthetic generation')])
    now = datetime.now(timezone.utc)
    replacement = (x509.CertificateBuilder().subject_name(leaf.subject).issuer_name(name)
                   .public_key(key.public_key()).serial_number(x509.random_serial_number())
                   .not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=1))
                   .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                   .add_extension(x509.SubjectAlternativeName([x509.DNSName('postgres.preflight.test')]), critical=False)
                   .add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
                   .sign(other, hashes.SHA256()))
    leaf_path.write_bytes(replacement.public_bytes(serialization.Encoding.PEM))
    actual = x509.load_pem_x509_certificate(leaf_path.read_bytes())
    assert actual.public_key().public_numbers() == key.public_key().public_numbers()
    try:
        actual.verify_directly_issued_by(root)
    except ValueError:
        witness.update(leafMatchesKey=True, leafIssuedByRoot=False)
    else:
        raise RuntimeError('Mixed issuance fault not observed')
else:
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    key_path.write_bytes(other.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    os.chown(key_path, 999, 999)
    os.chmod(key_path, 0o600)
    actual = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
    assert actual.public_key().public_numbers() != leaf.public_key().public_numbers()
    assert key_path.stat().st_uid == 999 and key_path.stat().st_mode & 0o777 == 0o600
    witness.update(leafMatchesKey=False, keyOwnerModePreserved=True)
print(json.dumps(witness, separators=(',', ':')))
