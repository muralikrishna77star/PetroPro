#!/usr/bin/env python3
"""Dump DBF table structures (field name, type, length, decimals) and row counts."""
import struct, sys, os, glob

TYPES = {"C": "Character", "N": "Numeric", "F": "Float", "D": "Date",
         "L": "Logical", "M": "Memo", "T": "DateTime", "I": "Integer",
         "B": "Double", "Y": "Currency"}

def read_dbf_header(path):
    with open(path, "rb") as f:
        header = f.read(32)
        if len(header) < 32:
            return None
        num_records = struct.unpack("<I", header[4:8])[0]
        header_size = struct.unpack("<H", header[8:10])[0]
        record_size = struct.unpack("<H", header[10:12])[0]
        fields = []
        f.seek(32)
        while True:
            fd = f.read(32)
            if not fd or fd[0:1] == b"\x0d":
                break
            if len(fd) < 32:
                break
            name = fd[0:11].split(b"\x00")[0].decode("latin-1").strip()
            ftype = chr(fd[11])
            flen = fd[16]
            fdec = fd[17]
            fields.append((name, ftype, flen, fdec))
        return {"records": num_records, "fields": fields}

def main():
    args = sys.argv[1:]
    for pattern in args:
        for path in sorted(glob.glob(pattern)):
            info = read_dbf_header(path)
            if not info:
                print(f"# {os.path.basename(path)}: unreadable")
                continue
            print(f"\n## {os.path.basename(path)}  ({info['records']} rows)")
            for name, ftype, flen, fdec in info["fields"]:
                tdesc = TYPES.get(ftype, ftype)
                size = f"{flen},{fdec}" if fdec else f"{flen}"
                print(f"  - {name:<12} {tdesc:<10} ({size})")

if __name__ == "__main__":
    main()
