"""Window: paste a screenshot (Ctrl+V) or open a file to get the FEN."""
import json
import os
import pathlib
import traceback
import webbrowser
import tkinter as tk
from tkinter import filedialog, messagebox, ttk

import numpy as np
from PIL import Image, ImageGrab, ImageTk

from chessfen import encroissant
from chessfen.overlay import draw_result

PREVIEW = 560
SETTINGS = pathlib.Path(os.environ.get("APPDATA", pathlib.Path.home())) / "img2fen" / "settings.json"


def load_settings():
    try:
        return json.loads(SETTINGS.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_settings(data):
    SETTINGS.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")


def clipboard_image():
    clip = ImageGrab.grabclipboard()
    if isinstance(clip, list) and clip:  # files copied in Explorer
        try:
            clip = Image.open(clip[0])
        except OSError:
            return None
    return clip.convert("RGB") if isinstance(clip, Image.Image) else None


class App:
    def __init__(self, root):
        self.root = root
        self.image = None
        self.photo = None
        self.result = None
        self.recognizer = None
        self.settings = load_settings()
        root.title("Image → FEN")
        root.geometry("640x800")
        root.report_callback_exception = self.show_error
        icon = pathlib.Path(__file__).resolve().parent / "model" / "icon.ico"
        if icon.exists():
            root.iconbitmap(default=str(icon))

        bar = ttk.Frame(root, padding=8)
        bar.pack(fill="x")
        ttk.Button(bar, text="Paste (Ctrl+V)", command=self.paste).pack(side="left")
        ttk.Button(bar, text="Open file…", command=self.open_file).pack(side="left", padx=6)
        self.auto_ec = tk.BooleanVar(value=self.settings.get("auto_encroissant", False))
        ttk.Checkbutton(bar, text="open in En Croissant right away", variable=self.auto_ec,
                        command=self.remember).pack(side="right")

        opts = ttk.Frame(root, padding=(8, 0))
        opts.pack(fill="x")
        self.turn = tk.StringVar(value="w")
        self.orientation = tk.StringVar(value="auto")
        ttk.Label(opts, text="To move:").pack(side="left")
        for text, val in (("White", "w"), ("Black", "b")):
            ttk.Radiobutton(opts, text=text, value=val, variable=self.turn, command=self.run).pack(side="left")
        ttk.Label(opts, text="   At the bottom:").pack(side="left")
        for text, val in (("auto", "auto"), ("White", "white"), ("Black", "black")):
            ttk.Radiobutton(opts, text=text, value=val, variable=self.orientation, command=self.run).pack(side="left")

        # bottom rows are packed before the preview so they always stay visible
        self.status = ttk.Label(root, padding=8, foreground="#a33", wraplength=620, justify="left")
        self.status.pack(side="bottom", fill="x")
        fen_row = ttk.Frame(root, padding=(8, 0))
        fen_row.pack(side="bottom", fill="x")
        self.fen = tk.StringVar()
        ttk.Entry(fen_row, textvariable=self.fen, font=("Consolas", 11)).pack(side="left", fill="x", expand=True)
        ttk.Button(fen_row, text="Copy", command=self.copy).pack(side="left", padx=(6, 0))
        ttk.Button(fen_row, text="lichess", command=self.lichess).pack(side="left", padx=(6, 0))
        ttk.Button(fen_row, text="En Croissant", command=self.to_encroissant).pack(side="left", padx=(6, 0))

        self.canvas = tk.Label(root, text="Copy a screenshot of a board (Win+Shift+S) and press Ctrl+V", anchor="center")
        self.canvas.pack(padx=8, pady=8, fill="both", expand=True)

        root.bind_all("<Control-v>", lambda e: self.paste())
        root.bind_all("<Control-V>", lambda e: self.paste())
        root.after(50, self.start)

    def start(self):
        self.status.config(text="Loading the model…", foreground="#555")
        self.root.update_idletasks()
        from chessfen.recognize import Recognizer  # torch import is slow: show the window first

        self.recognizer = Recognizer()
        self.status.config(text="")
        # a screenshot taken just before starting the program is picked up right away
        image = clipboard_image()
        if image is not None:
            self.image = image
            self.run(fresh=True, quiet=True)

    def show_error(self, exc, value, tb):
        messagebox.showerror("Error", "".join(traceback.format_exception(exc, value, tb))[-2000:])

    def remember(self):
        self.settings["auto_encroissant"] = self.auto_ec.get()
        save_settings(self.settings)

    def paste(self):
        image = clipboard_image()
        if image is None:
            messagebox.showinfo("No image", "There is no image in the clipboard.")
            return
        self.image = image
        self.run(fresh=True)

    def open_file(self):
        path = filedialog.askopenfilename(filetypes=[("Images", "*.png *.jpg *.jpeg *.gif *.bmp *.webp"), ("All files", "*")])
        if path:
            self.image = Image.open(path).convert("RGB")
            self.run(fresh=True)

    def run(self, fresh=False, quiet=False):
        """fresh: a new picture (not just a changed option). quiet: ignore pictures without a board."""
        if self.image is None or self.recognizer is None:
            return
        res = self.recognizer.recognize(np.asarray(self.image), turn=self.turn.get(),
                                        orientation=self.orientation.get())
        if quiet and not res.board_found:
            self.image = None
            return
        self.result = res
        self.fen.set(res.fen)
        x0, y0, x1, y1 = res.box
        pad = round((x1 - x0) * 0.05)
        shown = draw_result(self.image, res).crop((max(0, x0 - pad), max(0, y0 - pad),
                                                   min(self.image.width, x1 + pad), min(self.image.height, y1 + pad)))
        shown.thumbnail((PREVIEW, PREVIEW))
        self.photo = ImageTk.PhotoImage(shown)
        self.canvas.config(image=self.photo, text="")

        notes = []
        if not res.board_found:
            notes.append("Board grid not found — the whole image is treated as the board.")
        if self.orientation.get() == "auto":
            notes.append("Orientation (auto): " + ("Black at the bottom." if res.flipped else "White at the bottom."))
        if res.doubtful:
            notes.append("Doubtful squares (red): " + ", ".join(res.doubtful))
        notes += ["Illegal position: " + p for p in res.problems]

        if fresh and self.auto_ec.get():
            if res.board_found and not res.problems:
                if self.to_encroissant():
                    notes.append("Opened in En Croissant.")
            else:
                notes.append("Not sent to En Croissant automatically — check the position and press the button.")
        self.status.config(text="\n".join(notes), foreground="#a33" if res.problems or res.doubtful else "#555")

    def copy(self):
        self.root.clipboard_clear()
        self.root.clipboard_append(self.fen.get())

    def lichess(self):
        if self.fen.get():
            webbrowser.open("https://lichess.org/analysis/" + self.fen.get().replace(" ", "_"))

    def to_encroissant(self):
        fen = self.fen.get().strip()
        if not fen:
            return False
        exe = encroissant.find_exe(self.settings.get("encroissant_exe"))
        if exe is None:
            exe = filedialog.askopenfilename(title="Where is En Croissant installed? (en-croissant.exe)",
                                             filetypes=[("en-croissant.exe", "*.exe")])
            if not exe:
                return False
            self.settings["encroissant_exe"] = exe
            save_settings(self.settings)
        encroissant.open_position(fen, exe)
        return True


if __name__ == "__main__":
    root = tk.Tk()
    App(root)
    root.mainloop()
