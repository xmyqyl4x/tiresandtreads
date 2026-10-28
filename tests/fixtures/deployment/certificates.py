"""Fresh disposable deployment TLS/operator material; no external PKI or key export."""
from pathlib import Path
from datetime import datetime,timedelta,timezone
import os
from cryptography import x509
from cryptography.x509.oid import NameOID,ExtendedKeyUsageOID
from cryptography.hazmat.primitives import hashes,serialization
from cryptography.hazmat.primitives.asymmetric import rsa
p=Path('/deploy-tls');p.mkdir(exist_ok=True)
if any(p.iterdir()):raise RuntimeError('Refusing existing deployment TLS custody')
now=datetime.now(timezone.utc)
def key():return rsa.generate_private_key(public_exponent=65537,key_size=2048)
def name(label):return x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,label)])
def ca(label):
 k=key();n=name(label)
 c=x509.CertificateBuilder().subject_name(n).issuer_name(n).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=3)).add_extension(x509.BasicConstraints(ca=True,path_length=0),critical=True).sign(k,hashes.SHA256())
 return k,c
root,authority=ca('Synthetic deployment root');wrong,other=ca('Unrelated deployment root')
def issue(label,usage,issuer,issuer_key,expired=False):
 k=key();c=x509.CertificateBuilder().subject_name(name(label)).issuer_name(issuer.subject).public_key(k.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=2)).not_valid_after(now+timedelta(days=-1 if expired else 2)).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.SubjectAlternativeName([x509.DNSName(label)]),critical=False).add_extension(x509.ExtendedKeyUsage([usage]),critical=False).sign(issuer_key,hashes.SHA256())
 return k,c
def save(label,k,c):
 (p/(label+'.crt')).write_bytes(c.public_bytes(serialization.Encoding.PEM))
 path=p/(label+'.key');path.write_bytes(k.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()));os.chmod(path,0o600)
save('server',*issue('ingress.preflight.test',ExtendedKeyUsageOID.SERVER_AUTH,authority,root))
save('expired',*issue('ingress.preflight.test',ExtendedKeyUsageOID.SERVER_AUTH,authority,root,True))
save('operator',*issue('operator.preflight.test',ExtendedKeyUsageOID.CLIENT_AUTH,authority,root))
save('sibling',*issue('unapproved-operator.preflight.test',ExtendedKeyUsageOID.CLIENT_AUTH,authority,root))
save('foreign',*issue('operator.preflight.test',ExtendedKeyUsageOID.CLIENT_AUTH,other,wrong))
(p/'ca.crt').write_bytes(authority.public_bytes(serialization.Encoding.PEM));(p/'wrong-ca.crt').write_bytes(other.public_bytes(serialization.Encoding.PEM))
print('Created disposable deployment TLS/operator fixtures')
