"""Download piece sets from the lichess repository (used as training data)."""
import json
import pathlib
import urllib.request

API = "https://api.github.com/repos/lichess-org/lila/contents/public/piece"
RAW = "https://raw.githubusercontent.com/lichess-org/lila/master/public/piece/{}/{}"
SKIP = {"disguised", "mono", "monarchy"}  # identical-looking or non-SVG sets
PIECES = [c + p for c in "wb" for p in "KQRBNP"]
OUT = pathlib.Path(__file__).resolve().parent.parent / "data" / "pieces"


def main():
    sets = [d["name"] for d in json.load(urllib.request.urlopen(API)) if d["type"] == "dir"]
    for name in sets:
        if name in SKIP:
            continue
        dst = OUT / name
        dst.mkdir(parents=True, exist_ok=True)
        for p in PIECES:
            f = dst / f"{p}.svg"
            if f.exists():
                continue
            try:
                f.write_bytes(urllib.request.urlopen(RAW.format(name, p + ".svg")).read())
            except Exception as e:
                print(f"  {name}/{p}: {e}")
        print(name, "ok")


if __name__ == "__main__":
    main()
