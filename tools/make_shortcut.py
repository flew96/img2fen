"""Create "Image to FEN" shortcuts on the Desktop and in the Start menu.

The shortcut starts gui.py with pythonw.exe, so no console window appears.
"""
import base64
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from chessfen.pieces import _render_svg  # noqa: E402

NAME = "Image to FEN"


def make_icon():
    icon = ROOT / "model" / "icon.ico"
    img = _render_svg(ROOT / "data" / "pieces" / "cburnett" / "wN.svg", 256)
    img.save(icon, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    return icon


def main():
    pythonw = ROOT / ".venv" / "Scripts" / "pythonw.exe"
    icon = make_icon()
    script = f"""
$ws = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))) {{
    # WScript.Shell cannot save non-ANSI file names: save under an ASCII name, then rename
    $final = Join-Path $dir '{NAME}.lnk'
    $tmp = Join-Path $dir 'img2fen-tmp.lnk'
    $lnk = $ws.CreateShortcut($tmp)
    $lnk.TargetPath = '{pythonw}'
    $lnk.Arguments = '"{ROOT / "gui.py"}"'
    $lnk.WorkingDirectory = '{ROOT}'
    $lnk.IconLocation = '{icon},0'
    $lnk.Description = 'Chess position from an image -> FEN / En Croissant'
    $lnk.Save()
    Move-Item -LiteralPath $tmp -Destination $final -Force
    Write-Output $final
}}
"""
    # -EncodedCommand keeps non-ASCII names intact (plain -Command goes through the ANSI codepage)
    encoded = base64.b64encode(script.encode("utf-16-le")).decode()
    subprocess.run(["powershell", "-NoProfile", "-EncodedCommand", encoded], check=True)


if __name__ == "__main__":
    main()
