"""Small CNN that classifies one 64x64 square into 13 classes."""
import torch
from torch import nn

from .labels import CLASSES

TILE = 64


def _block(cin, cout):
    return nn.Sequential(
        nn.Conv2d(cin, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.Conv2d(cout, cout, 3, padding=1, bias=False), nn.BatchNorm2d(cout), nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class SquareNet(nn.Module):
    def __init__(self, n_classes=len(CLASSES)):
        super().__init__()
        self.features = nn.Sequential(_block(3, 32), _block(32, 64), _block(64, 128), _block(128, 256))
        self.head = nn.Sequential(nn.AdaptiveAvgPool2d(1), nn.Flatten(), nn.Dropout(0.2), nn.Linear(256, n_classes))

    def forward(self, x):
        """x: (N, 3, 64, 64) uint8 or float in [0, 255]."""
        x = x.float() / 127.5 - 1
        return self.head(self.features(x))


def load_model(path, device="cpu"):
    model = SquareNet()
    model.load_state_dict(torch.load(path, map_location=device, weights_only=True))
    return model.to(device).eval()
