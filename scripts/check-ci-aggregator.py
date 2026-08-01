#!/usr/bin/env python3
"""Vérifie que le check agrégateur attend bien tous les jobs du workflow.

La protection de branche n'exige qu'un seul check, `CI`, qui agrège les autres par son `needs:` —
une liste tenue à la main. Un job absent de cette liste échouerait sans bloquer la PR, et rien ne le
signalait : ni actionlint, qui ne juge que la validité du workflow, ni `make check`.

Le fichier est lu ligne à ligne plutôt que par un analyseur YAML : aucune dépendance à installer, ni
côté poste ni côté runner, pour une structure dont on ne lit que deux motifs.
"""

import re
import sys
from pathlib import Path

WORKFLOW = Path(__file__).resolve().parent.parent / ".github" / "workflows" / "ci.yml"
AGGREGATOR = "ci"

JOB = re.compile(r"^  ([a-z][a-z0-9-]*):\s*$")
NEEDS = re.compile(r"^\s*needs:\s*\[([^\]]*)\]")


def main() -> int:
    lines = WORKFLOW.read_text(encoding="utf-8").splitlines()

    # Les noms à deux espaces d'indentation n'appartiennent à `jobs:` que sous cette section : ailleurs
    # ce sont les déclencheurs de `on:`, et `push` s'y faisait prendre pour un job.
    in_jobs = False
    jobs: set[str] = set()
    for line in lines:
        if re.match(r"^[a-z]", line):
            in_jobs = line.startswith("jobs:")
        elif in_jobs and (m := JOB.match(line)):
            jobs.add(m.group(1))
    jobs -= {AGGREGATOR}
    needed = {
        name.strip()
        for line in lines
        if (m := NEEDS.match(line))
        for name in m.group(1).split(",")
        if name.strip()
    }

    if not jobs:
        print(f"{WORKFLOW.name} : aucun job trouvé — le format a changé, cette porte ne garde plus rien")
        return 1

    orphans = sorted(jobs - needed)
    if orphans:
        for job in orphans:
            print(
                f'le job « {job} » ne figure pas dans le `needs:` de l\'agrégateur `{AGGREGATOR}` : '
                f"il échouerait sans bloquer la PR"
            )
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
