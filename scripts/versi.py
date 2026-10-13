"""Beri setiap file CSS/JS nomor versi dari isi filenya (hash), lalu tulis ke semua halaman HTML.

Kenapa: GitHub Pages menyuruh browser menyimpan CSS/JS ~10 menit. Tanpa nomor versi, halaman baru bisa
dimuat bersama CSS lama sehingga tampilan berantakan. Dengan hash isi file, setiap perubahan file otomatis
menghasilkan alamat baru (mis. site.css?v=3f9a1c2e) yang tidak mungkin diambil dari cache lama.

Jalankan sebelum commit:  python3 scripts/versi.py
Periksa saja (untuk uji):  python3 scripts/versi.py --check
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ["index.html", "app.html", "akun.html", "admin.html", "privasi.html"]
REF = re.compile(r'((?:href|src)=")((?:assets|vendor)/[^"?]+\.(?:css|js))(?:\?v=[^"]*)?(")')


def file_hash(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()[:10]


def stamp(check: bool) -> int:
    stale = []
    for page in PAGES:
        path = ROOT / page
        text = path.read_text(encoding="utf-8")
        new = REF.sub(lambda m: f"{m.group(1)}{m.group(2)}?v={file_hash(m.group(2))}{m.group(3)}", text)
        if new != text:
            stale.append(page)
            if not check:
                path.write_text(new, encoding="utf-8")
    # versi cache service worker = gabungan semua hash, agar cache offline ikut diperbarui
    sw = ROOT / "sw.js"
    files = sorted({m.group(2) for p in PAGES for m in REF.finditer((ROOT / p).read_text(encoding="utf-8"))})
    build = hashlib.sha256("".join(file_hash(f) for f in files).encode()).hexdigest()[:10]
    sw_text = sw.read_text(encoding="utf-8")
    sw_new = re.sub(r"const VERSION = '[^']*';", f"const VERSION = 'cekprofit-{build}';", sw_text)
    if sw_new != sw_text:
        stale.append("sw.js")
        if not check:
            sw.write_text(sw_new, encoding="utf-8")
    if check:
        if stale:
            print("Nomor versi belum diperbarui di:", ", ".join(stale), "-> jalankan: python3 scripts/versi.py")
            return 1
        print("Nomor versi cocok dengan isi file.")
        return 0
    print("Diperbarui:", ", ".join(stale) if stale else "tidak ada perubahan")
    return 0


if __name__ == "__main__":
    sys.exit(stamp(check="--check" in sys.argv))
