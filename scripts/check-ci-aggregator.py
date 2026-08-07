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
    #
    # Le `needs:` se lit **dans le bloc de l'agrégateur**, et nulle part ailleurs. La version d'avant
    # les collectait tous, ce qui était sans effet tant que le workflow n'en portait qu'un : le job
    # `e2e` a introduit le second, et un job cité par un autre job passait alors pour attendu par
    # l'agrégateur. Mesuré le 03/08/2026 en retirant `build-web` de la liste de `ci` — le seul job qui
    # exerce la chaîne complète et le contrôle du binaire aurait pu échouer sans bloquer une PR, et
    # cette porte rendait 0.
    in_jobs = False
    in_aggregator = False
    jobs: set[str] = set()
    needed: set[str] = set()
    for line in lines:
        if re.match(r"^[a-z]", line):
            in_jobs = line.startswith("jobs:")
            in_aggregator = False
        elif in_jobs and (m := JOB.match(line)):
            jobs.add(m.group(1))
            in_aggregator = m.group(1) == AGGREGATOR
        elif in_aggregator and (m := NEEDS.match(line)):
            needed |= {name.strip() for name in m.group(1).split(",") if name.strip()}
    jobs -= {AGGREGATOR}

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
