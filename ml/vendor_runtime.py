"""Vendor a pinned ONNX Runtime Web build with registry-integrity verification."""
import base64
import hashlib
import io
import json
from pathlib import Path
import tarfile
import urllib.request

version = '1.23.2'
metadata = json.load(urllib.request.urlopen(f'https://registry.npmjs.org/onnxruntime-web/{version}', timeout=60))
payload = urllib.request.urlopen(metadata['dist']['tarball'], timeout=120).read()
algorithm, expected = metadata['dist']['integrity'].split('-',1)
assert algorithm == 'sha512'
assert base64.b64encode(hashlib.sha512(payload).digest()).decode() == expected
output = Path(__file__).resolve().parent.parent / 'dist/vendor'
output.mkdir(exist_ok=True)
names = ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm']
with tarfile.open(fileobj=io.BytesIO(payload), mode='r:gz') as archive:
    for name in names:
        member = archive.getmember('package/dist/'+name)
        assert member.isfile()
        (output / name).write_bytes(archive.extractfile(member).read())
    license_members = [m for m in archive.getmembers() if m.isfile() and m.name.lower() in ('package/license', 'package/license.txt', 'package/license.md')]
    if not license_members:
        license_bytes = urllib.request.urlopen(f'https://raw.githubusercontent.com/microsoft/onnxruntime/v{version}/LICENSE', timeout=60).read()
    else:
        license_bytes = archive.extractfile(license_members[0]).read()
    (output / 'ONNX-RUNTIME-LICENSE.txt').write_bytes(license_bytes)
(output / 'provenance.json').write_text(json.dumps(dict(package='onnxruntime-web',version=version,
    source=metadata['dist']['tarball'],integrity=metadata['dist']['integrity']),indent=2))
print('Vendored ONNX Runtime Web', version, names)
