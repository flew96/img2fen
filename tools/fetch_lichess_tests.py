"""Download real board renders from lichess's image export as a test set.

Writes data/real/*.png and data/real/manifest.json ({file: {fen, flipped}}).
"""
import io
import json
import pathlib
import random
import time
import urllib.parse
import urllib.request

from PIL import Image

OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "real"
URL = "https://lichess1.org/export/fen.gif?"

POSITIONS = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", "e2e4"),
    ("r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R", "f1b5"),
    ("r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP1B1PPP/R2QKB1R", "c8d7"),
    ("2r3k1/1p3pp1/p3p2p/3pP3/P2P4/1P3N1P/5PP1/2R3K1", "f6e5"),
    ("8/5pk1/6p1/3P4/1p3P2/1P4K1/8/8", "g8g7"),
    ("r4rk1/1bq1bppp/p2ppn2/1p6/3NP3/1BN1BP2/PPPQ2PP/2KR3R", "d1c1"),
    ("6k1/5ppp/8/8/8/8/5PPP/3R2K1", "d2d1"),
    ("r2qk2r/pb4pp/1n2Pb2/2B2Q2/p1p5/2P5/2B2PPP/RN2R1K1", "f3f5"),
    ("3r2k1/p4ppp/1p6/2p1n3/2P1P3/1P3N1P/P4PP1/3R2K1", "e6e5"),
    ("4k3/8/8/2b5/8/8/3N4/4K3", None),
    ("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR", "d8h4"),
    ("1k6/ppp5/8/8/8/8/5PPP/6K1", None),
    ("r1b1k1nr/p2p1ppp/n2B4/1p1NPN1P/6P1/3P1Q2/P1P1K3/q5b1", "d4d6"),
    ("8/8/4kpp1/3p4/p6P/2B4b/6P1/6K1", None),
    ("r3k2r/ppp2ppp/2n1bn2/2bqp3/8/2NPBN2/PPPQBPPP/R3K2R", "e1e1"),
    ("2kr3r/ppp2ppp/2n5/2b1p3/4P1b1/2NP1N2/PPP2PPP/R1B1K2R", "e8c8"),
]
THEMES = ["brown", "blue", "green", "purple", "ic", "wood", "maple", "marble", "grey", "olive",
          "canvas", "metal", "newspaper", "leather", "pink", "blue-marble", "green-plastic"]
PIECES = ["cburnett", "merida", "alpha", "pirouetti", "chessnut", "chess7", "reillycraig",
          "companion", "riohacha", "kosal", "leipzig", "fantasy", "spatial", "california",
          "pixel", "maestro", "fresca", "cardinal", "gioco", "tatiana", "staunty", "governor",
          "dubrovny", "icpieces", "mpchess", "kiwen-suwi", "horsey", "anarcandy", "shapes"]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(3)
    mf = OUT / "manifest.json"
    manifest = json.loads(mf.read_text()) if mf.exists() else {}
    for i, (fen, last) in enumerate(POSITIONS * 3):
        flipped = rng.random() < 0.3
        params = {"fen": fen, "theme": rng.choice(THEMES), "piece": rng.choice(PIECES),
                  "color": "black" if flipped else "white"}
        if last and rng.random() < 0.7:
            params["lastMove"] = last
        if fen.count("k") and rng.random() < 0.15:
            params["check"] = "e8"
        name = f"lichess_{i:02d}_{params['theme']}_{params['piece']}.png"
        if name in manifest:
            continue
        for attempt in range(3):
            try:
                data = urllib.request.urlopen(URL + urllib.parse.urlencode(params)).read()
                break
            except urllib.error.HTTPError as e:
                if e.code != 429:
                    raise
                time.sleep(60)  # rate limited
        else:
            print("fail", name)
            continue
        Image.open(io.BytesIO(data)).convert("RGB").save(OUT / name)
        manifest[name] = {"fen": fen, "flipped": flipped}
        mf.write_text(json.dumps(manifest, indent=1))
        time.sleep(2)
    print(len(manifest), "images")


if __name__ == "__main__":
    main()
