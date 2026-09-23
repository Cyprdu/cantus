#!/usr/bin/env python3
"""Remet le petit identifiant (A20, LC5, P3, ES12…) devant le nom des partitions.

Les partitions ont été renommées sans leur identifiant (« A20_-_Je_Suis_Né_pour_Te_Louer.pdf »
est devenu « Je_Suis_Né_pour_Te_Louer.pdf »). La correspondance exacte, fichier par fichier,
est gardée dans ids_partitions.json, à côté de ce script. Ce programme la relit et remet chaque
partition (et ses paroles) sous son ancien nom, dans le même dossier.

Utilisation, depuis n'importe où :
    python outils/restaurer_ids.py            -> renomme les fichiers
    python outils/restaurer_ids.py --essai    -> affiche seulement ce qui serait fait
    python outils/restaurer_ids.py --inverse  -> refait l'inverse (retire à nouveau les identifiants)

Le renommage passe par « git mv » quand c'est possible (le fichier garde le même contenu, donc
le même identifiant dans l'application : playlists et messes continuent de fonctionner). Il ne
reste ensuite qu'à committer et pousser :
    git commit -m "Remet les identifiants des partitions" && git push
"""
import json
import os
import subprocess
import sys

OUTILS = os.path.dirname(os.path.abspath(__file__))
DEPOT = os.path.dirname(OUTILS)
CORRESPONDANCE = os.path.join(OUTILS, "ids_partitions.json")


def renommer(source, cible, essai):
    src = os.path.join(DEPOT, source)
    dst = os.path.join(DEPOT, cible)
    if os.path.exists(dst):
        return "deja"
    if not os.path.exists(src):
        return "absent"
    if essai:
        return "ok"
    r = subprocess.run(["git", "mv", source, cible], cwd=DEPOT, capture_output=True)
    if r.returncode != 0:  # fichier non suivi par git, ou git absent : simple renommage
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.rename(src, dst)
    return "ok"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    essai = "--essai" in sys.argv
    inverse = "--inverse" in sys.argv
    de, vers = ("avec_id", "sans_id") if inverse else ("sans_id", "avec_id")

    with open(CORRESPONDANCE, encoding="utf-8") as f:
        entrees = json.load(f)

    compte = {"ok": 0, "deja": 0, "absent": 0}
    for e in entrees:
        for genre in ("partition", "paroles"):
            if genre not in e:
                continue
            source, cible = e[genre][de], e[genre][vers]
            etat = renommer(source, cible, essai)
            compte[etat] += 1
            if etat == "ok":
                print(f"{'[essai] ' if essai else ''}{source}  ->  {os.path.basename(cible)}")
            elif etat == "absent":
                print(f"INTROUVABLE (déplacé ou supprimé ?) : {source}")

    print()
    print(f"{compte['ok']} fichier(s) renommé(s){' (essai, rien de modifié)' if essai else ''}, "
          f"{compte['deja']} déjà au bon nom, {compte['absent']} introuvable(s).")
    if compte["ok"] and not essai:
        print('Pensez à committer et pousser : git commit -m "Remet les identifiants des partitions" && git push')


if __name__ == "__main__":
    main()
