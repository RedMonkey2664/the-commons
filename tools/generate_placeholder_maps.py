#!/usr/bin/env python3
"""
Generates placeholder Tiled (.json) maps for The Commons.

These are REAL Tiled 1.10 orthogonal map exports, not a bespoke format - Phaser
loads them through its normal tilemap loader, so replacing one with a
hand-authored Tiled file in Phase 5 requires zero code changes.

Run:  python tools/generate_placeholder_maps.py
"""

import json
import os
import random

TILE = 16
TILESET_NAME = "commons_placeholder"

# Tile ids are 0-based within the tileset; gid = id + firstgid(1).
T_GRASS = 0
T_GRASS_ALT = 1
T_PATH = 2
T_TREE = 3
T_WATER = 4
T_WALL = 5
T_SIGN = 6
T_DOOR = 7
T_FLOWER = 8
T_PLAZA = 9

COLLIDING = {T_TREE, T_WATER, T_WALL, T_SIGN}
AMBIENT = {T_FLOWER: "grassSway", T_GRASS_ALT: "grassSway"}

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "maps")


class MapBuilder:
    def __init__(self, width, height, seed=7):
        self.w = width
        self.h = height
        self.ground = [T_GRASS] * (width * height)
        self.decor = [-1] * (width * height)  # -1 == empty
        self.objects = []
        self.rng = random.Random(seed)
        self._next_id = 1

    # -- tile helpers -------------------------------------------------------
    def _i(self, x, y):
        return y * self.w + x

    def set_ground(self, x, y, tile):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.ground[self._i(x, y)] = tile

    def set_decor(self, x, y, tile):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.decor[self._i(x, y)] = tile

    def fill_ground(self, x0, y0, x1, y1, tile):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set_ground(x, y, tile)

    def fill_decor(self, x0, y0, x1, y1, tile):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.set_decor(x, y, tile)

    def decor_at(self, x, y):
        return self.decor[self._i(x, y)]

    def ground_at(self, x, y):
        return self.ground[self._i(x, y)]

    # -- object helpers -----------------------------------------------------
    def add_object(self, name, kind, tx, ty, blocks, props=None):
        obj = {
            "height": TILE,
            "id": self._next_id,
            "name": name,
            "rotation": 0,
            "type": "interactable",
            "visible": True,
            "width": TILE,
            "x": tx * TILE,
            "y": ty * TILE,
            "properties": [
                {"name": "kind", "type": "string", "value": kind},
                {"name": "blocks", "type": "bool", "value": blocks},
            ],
        }
        for key, value in (props or {}).items():
            if isinstance(value, bool):
                ptype = "bool"
            elif isinstance(value, int):
                ptype = "int"
            else:
                ptype = "string"
            obj["properties"].append({"name": key, "type": ptype, "value": value})
        self._next_id += 1
        self.objects.append(obj)

    def add_point(self, name, kind, tx, ty, props=None):
        obj = {
            "height": 0,
            "id": self._next_id,
            "name": name,
            "point": True,
            "rotation": 0,
            "type": kind,
            "visible": True,
            "width": 0,
            "x": tx * TILE + TILE / 2,
            "y": ty * TILE + TILE / 2,
            "properties": [
                {"name": key, "type": "string", "value": value}
                for key, value in (props or {}).items()
            ],
        }
        self._next_id += 1
        self.objects.append(obj)

    # -- serialization ------------------------------------------------------
    def tileset(self):
        tiles = {}
        for tid in COLLIDING:
            tiles.setdefault(tid, []).append(
                {"name": "collides", "type": "bool", "value": True}
            )
        for tid, key in AMBIENT.items():
            tiles.setdefault(tid, []).append(
                {"name": "ambient", "type": "string", "value": key}
            )
        return {
            "columns": 10,
            "firstgid": 1,
            "image": "../tilesets/commons_placeholder.png",
            "imageheight": TILE,
            "imagewidth": TILE * 10,
            "margin": 0,
            "name": TILESET_NAME,
            "spacing": 0,
            "tilecount": 10,
            "tileheight": TILE,
            "tilewidth": TILE,
            "tiles": [
                {"id": tid, "properties": props}
                for tid, props in sorted(tiles.items())
            ],
        }

    def to_json(self):
        return {
            "compressionlevel": -1,
            "height": self.h,
            "infinite": False,
            "layers": [
                {
                    "data": [t + 1 for t in self.ground],
                    "height": self.h,
                    "id": 1,
                    "name": "ground",
                    "opacity": 1,
                    "type": "tilelayer",
                    "visible": True,
                    "width": self.w,
                    "x": 0,
                    "y": 0,
                },
                {
                    "data": [0 if t < 0 else t + 1 for t in self.decor],
                    "height": self.h,
                    "id": 2,
                    "name": "decor",
                    "opacity": 1,
                    "type": "tilelayer",
                    "visible": True,
                    "width": self.w,
                    "x": 0,
                    "y": 0,
                },
                {
                    "draworder": "topdown",
                    "id": 3,
                    "name": "objects",
                    "objects": self.objects,
                    "opacity": 1,
                    "type": "objectgroup",
                    "visible": True,
                    "x": 0,
                    "y": 0,
                },
            ],
            "nextlayerid": 4,
            "nextobjectid": self._next_id,
            "orientation": "orthogonal",
            "renderorder": "right-down",
            "tiledversion": "1.10.2",
            "tileheight": TILE,
            "tilesets": [self.tileset()],
            "tilewidth": TILE,
            "type": "map",
            "version": "1.10",
            "width": self.w,
        }


def build_town_square():
    """
    30x22 hub. Layout mirrors 03_WORLD_MAP_ZONES.md: Library west, Cafe east,
    Park north, Arcade south, all one hop from the central plaza spawn.
    """
    m = MapBuilder(30, 22)

    # --- paths -------------------------------------------------------------
    m.fill_ground(8, 10, 21, 11, T_PATH)   # east-west road (Library <-> Cafe)
    m.fill_ground(14, 2, 15, 15, T_PATH)   # north-south road (Park <-> Arcade)
    m.fill_ground(12, 9, 18, 13, T_PLAZA)  # central plaza

    # --- tree border -------------------------------------------------------
    for y in range(m.h):
        for x in (0, 1, m.w - 2, m.w - 1):
            m.set_decor(x, y, T_TREE)
    for x in range(m.w):
        for y in (0, 1, m.h - 2, m.h - 1):
            m.set_decor(x, y, T_TREE)

    # Park gate: an opening in the north border.
    for y in (0, 1):
        m.set_decor(15, y, -1)
        m.set_ground(15, y, T_PATH)

    # --- buildings (wall blocks; doorways carved out below) ----------------
    m.fill_decor(2, 7, 7, 12, T_WALL)    # Library, door faces east
    m.fill_decor(22, 7, 27, 12, T_WALL)  # Cafe, door faces west
    m.fill_decor(11, 16, 19, 19, T_WALL) # Arcade, door faces north

    for dx, dy in ((7, 10), (22, 10), (15, 16)):
        m.set_decor(dx, dy, -1)
        m.set_ground(dx, dy, T_PATH)

    # --- pond --------------------------------------------------------------
    m.fill_decor(20, 14, 23, 17, T_WATER)

    # --- scattered scenery on open grass -----------------------------------
    for _ in range(150):
        x = m.rng.randrange(2, m.w - 2)
        y = m.rng.randrange(2, m.h - 2)
        if m.ground_at(x, y) != T_GRASS or m.decor_at(x, y) != -1:
            continue
        roll = m.rng.random()
        if roll < 0.28:
            m.set_decor(x, y, T_TREE)
        elif roll < 0.60:
            m.set_decor(x, y, T_FLOWER)
        else:
            m.set_ground(x, y, T_GRASS_ALT)

    # --- objects -----------------------------------------------------------
    m.add_point("spawn", "spawn", 15, 12)

    m.add_object("sign_welcome", "signpost", 16, 12, True, {
        "text": "THE COMMONS - town square.|"
                "Library's quiet, Cafe's for talking, Arcade's for messing around.|"
                "Park's just for existing.",
    })
    m.add_object("sign_library", "signpost", 9, 9, True, {
        "text": "WEST: LIBRARY|Focus pods and a reading nook. Keep it down in there.",
    })
    m.add_object("sign_cafe", "signpost", 20, 9, True, {
        "text": "EAST: CAFE|Shared jukebox, warm drinks, loud opinions.",
    })
    m.add_object("sign_park", "signpost", 13, 4, True, {
        "text": "NORTH: PARK|Benches and a bandstand. Nothing is required of you here.",
    })
    m.add_object("sign_arcade", "signpost", 16, 15, True, {
        "text": "SOUTH: ARCADE|Cabinets, high scores, and the only losing in this town.",
    })

    m.add_object("npc_wanderer", "npc", 12, 13, True, {
        "text": "Oh - hey. I just walk laps out here while my timer runs.|"
                "Something about a moving avatar makes it easier to sit still.",
        "portrait": "npc",
    })

    doors = (
        ("door_library", 7, 10, "library", "LIBRARY"),
        ("door_cafe", 22, 10, "cafe", "CAFE"),
        ("door_arcade", 15, 16, "arcade", "ARCADE"),
        ("door_park", 15, 1, "park", "PARK"),
    )
    for name, tx, ty, zone, label in doors:
        m.add_object(name, "door", tx, ty, False, {"targetZone": zone, "label": label})

    return m


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.abspath(os.path.join(OUT_DIR, "town_square.json"))
    with open(out, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(build_town_square().to_json(), fh, indent=1)
        fh.write("\n")
    print("wrote", out)


if __name__ == "__main__":
    main()
