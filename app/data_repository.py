import json
import re
from pathlib import Path
from typing import Dict, List, Optional

from app.config import Settings
from app.models import IMSBundle, IMSListItem, SECTION_NAMES


class DataRepository:
    FILE_PATTERN = re.compile(r"^SEPM1763-(\d+)(?:_[a-z]+)?\.json$")

    def __init__(self, settings: Settings):
        self.settings = settings
        self._index: Dict[str, Dict[str, Path]] = {}
        self.scan()

    @classmethod
    def extract_ims_no(cls, filename: str) -> Optional[str]:
        match = cls.FILE_PATTERN.match(filename)
        if not match:
            return None
        return match.group(1)

    def scan(self) -> None:
        index: Dict[str, Dict[str, Path]] = {}

        for section, section_dir in self.settings.section_dirs.items():
            if not section_dir.exists():
                continue

            for path in sorted(section_dir.glob("*.json")):
                ims_no = self.extract_ims_no(path.name)
                if ims_no is None:
                    continue
                index.setdefault(ims_no, {})[section] = path

        self._index = index

    def list_ims(self) -> List[IMSListItem]:
        self.scan()
        items: List[IMSListItem] = []

        for ims_no in sorted(self._index.keys(), key=int):
            section_paths = self._index[ims_no]
            available_sections = [
                section for section in SECTION_NAMES if section in section_paths
            ]
            missing_sections = [
                section for section in SECTION_NAMES if section not in section_paths
            ]
            items.append(
                IMSListItem(
                    ims_no=ims_no,
                    available_sections=available_sections,
                    missing_sections=missing_sections,
                    source_files={
                        section: str(section_paths[section])
                        for section in available_sections
                    },
                )
            )

        return items

    def load_bundle(self, ims_no: str) -> IMSBundle:
        self.scan()
        section_paths = self._index.get(ims_no)
        if section_paths is None:
            raise KeyError(ims_no)

        payload = {
            "ims_no": ims_no,
            "source_files": {},
            "missing_sections": [],
        }

        for section in SECTION_NAMES:
            path = section_paths.get(section)
            if path is None:
                payload[section] = None
                payload["missing_sections"].append(section)
                continue

            with path.open("r", encoding="utf-8") as handle:
                payload[section] = json.load(handle)
            payload["source_files"][section] = str(path)

        return IMSBundle(**payload)
