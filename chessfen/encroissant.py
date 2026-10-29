"""Opening a recognized position in En Croissant.

En Croissant takes a PGN path as its first command-line argument
(`en-croissant.exe game.pgn`) and opens it in a new tab; a PGN with
[SetUp "1"] and [FEN ...] headers starts from that position.
"""
import datetime
import os
import pathlib
import shutil
import subprocess

POSITIONS_DIR = pathlib.Path.home() / "Documents" / "chess-positions"

_CANDIDATES = [
    pathlib.Path(os.environ.get("LOCALAPPDATA", "")) / "en-croissant" / "en-croissant.exe",
    pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "En Croissant" / "en-croissant.exe",
    pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "en-croissant" / "en-croissant.exe",
]


def find_exe(configured=None):
    """Path to en-croissant.exe or None."""
    candidates = ([configured] if configured else []) + _CANDIDATES
    for path in candidates:
        if pathlib.Path(path).is_file():
            return str(path)
    return shutil.which("en-croissant")


def write_pgn(fen, folder=POSITIONS_DIR):
    now = datetime.datetime.now()
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"position_{now:%Y-%m-%d_%H-%M-%S}.pgn"
    path.write_text(
        f'[Event "Позиция с картинки {now:%d.%m %H:%M}"]\n'
        f'[Site "?"]\n[Date "{now:%Y.%m.%d}"]\n[Round "?"]\n'
        f'[White "?"]\n[Black "?"]\n[Result "*"]\n'
        f'[SetUp "1"]\n[FEN "{fen}"]\n\n*\n',
        encoding="utf-8",
    )
    return path


def open_position(fen, exe):
    """Save the position as PGN and open it in En Croissant. Returns the PGN path."""
    path = write_pgn(fen)
    flags = getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
    subprocess.Popen([exe, str(path)], creationflags=flags, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return path
