"""Small CIFAR-10 non-leaf development cohort; never a farm-input guarantee.

Uses the publisher binary archive and checksum. No pickle or archive extraction.
Original 32px images are not redistributed and must be reported as low-resolution.
"""
import hashlib
import io
import json
import tarfile
import urllib.request
import numpy as np
from PIL import Image
from train_baseline import ROOT, dump

def run():
    data=ROOT/'data/nonleaf-v2';data.mkdir(parents=True,exist_ok=True)
    archive=data/'cifar-10-binary.tar.gz'
    url='https://cave.cs.toronto.edu/kriz/cifar-10-binary.tar.gz'
    if not archive.exists():
        partial=data/'download.partial'
        with urllib.request.urlopen(url,timeout=120) as response,partial.open('wb') as output:
            while chunk:=response.read(1024*1024):output.write(chunk)
        partial.replace(archive)
    assert hashlib.md5(archive.read_bytes()).hexdigest()=='c32a1d4ab5d03f1284b67883e8d87530'
    records=[]
    with tarfile.open(archive) as tar:
        # Training partition only; the official test partition remains unused.
        stream=tar.extractfile('cifar-10-batches-bin/data_batch_1.bin')
        batch=np.frombuffer(stream.read(),dtype=np.uint8).reshape(-1,3073)
        for label in range(10):
            indices=np.where(batch[:,0]==label)[0][:120]
            for j,index in enumerate(indices):
                rgb=batch[index,1:].reshape(3,32,32).transpose(1,2,0)
                image=Image.fromarray(rgb);path=data/f'{int(index)}.png';image.save(path)
                payload=path.read_bytes()
                records.append(dict(source='CIFAR10',source_class=int(label),original_index=int(index),label='unsupported',
                    split='train' if j<100 else 'validation',path=path.relative_to(ROOT).as_posix(),
                    sha256=hashlib.sha256(payload).hexdigest(),pixel_sha256=hashlib.sha256(str((32,32)).encode()+rgb.tobytes()).hexdigest()))
    out=ROOT/'field-v2';out.mkdir(exist_ok=True)
    dump(out/'nonleaf_manifest.json',records)
    dump(out/'nonleaf_source.json',dict(url=url,md5='c32a1d4ab5d03f1284b67883e8d87530',citation='Alex Krizhevsky, Learning Multiple Layers of Features from Tiny Images, 2009',
        description='1,000 train and 200 validation images from official training batch 1; 10 object/animal categories.',
        limitations='32x32 images resized to model input. Not representative of full-resolution farm-phone mistakes. Official test partition unused.'))
    print('Prepared 1,000 non-leaf training and 200 development-validation images.',flush=True)

if __name__=='__main__':run()
