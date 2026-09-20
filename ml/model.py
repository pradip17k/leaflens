"""Small CPU-friendly baseline. Preprocessing is shared by training and prediction."""
import torch
from torch import nn
from PIL import Image, ImageOps
import numpy as np

IMAGE_SIZE = 128


class LeafCNN(nn.Module):
    def __init__(self, num_classes=9):
        super().__init__()
        layers = []
        previous = 3
        for channels in (16, 32, 64, 96):
            layers.extend([nn.Conv2d(previous, channels, 3, stride=2, padding=1, bias=False),
                           nn.BatchNorm2d(channels), nn.ReLU(inplace=True)])
            previous = channels
        self.features = nn.Sequential(*layers, nn.AdaptiveAvgPool2d(1))
        self.classifier = nn.Sequential(nn.Flatten(), nn.Dropout(.25), nn.Linear(96, num_classes))

    def forward(self, images):
        return self.classifier(self.features(images))


def read_image(path):
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert('RGB')
        image = image.resize((IMAGE_SIZE, IMAGE_SIZE), Image.Resampling.BILINEAR)
        return np.array(image, dtype=np.uint8)


def preprocess(batch):
    # Input: uint8 NCHW. Output: float32 in [-1, 1].
    return batch.float().div(127.5).sub(1)


def build_model(architecture, num_classes=9, pretrained=False):
    if architecture == 'LeafCNN':
        return LeafCNN(num_classes)
    if architecture == 'MobileNetV2':
        from torchvision.models import mobilenet_v2, MobileNet_V2_Weights
        model = mobilenet_v2(weights=MobileNet_V2_Weights.IMAGENET1K_V2 if pretrained else None)
        model.classifier[1] = nn.Linear(model.last_channel, num_classes)
        return model
    raise ValueError('Unknown architecture')


def preprocess_for_model(batch, architecture):
    if architecture == 'LeafCNN':
        return preprocess(batch)
    batch = batch.float().div(255)
    mean = torch.tensor([.485, .456, .406]).view(1, 3, 1, 1)
    std = torch.tensor([.229, .224, .225]).view(1, 3, 1, 1)
    return (batch-mean)/std


def metrics(target, predicted, classes):
    matrix = np.zeros((len(classes), len(classes)), dtype=np.int64)
    for actual, guess in zip(target, predicted):
        matrix[actual, guess] += 1
    per_class = []
    for i, label in enumerate(classes):
        tp = int(matrix[i, i])
        support, called = int(matrix[i].sum()), int(matrix[:, i].sum())
        precision = tp / called if called else 0.0
        recall = tp / support if support else 0.0
        f1 = 2*precision*recall/(precision+recall) if precision+recall else 0.0
        per_class.append(dict(label=label, support=support, precision=precision, recall=recall, f1=f1))
    return dict(count=len(target), accuracy=float(np.trace(matrix)/matrix.sum()) if matrix.sum() else 0,
                macro_precision=float(np.mean([x['precision'] for x in per_class])),
                macro_recall=float(np.mean([x['recall'] for x in per_class])),
                macro_f1=float(np.mean([x['f1'] for x in per_class])),
                per_class=per_class, confusion_matrix=matrix.tolist(), class_order=classes)
