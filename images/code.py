import os
import shutil
import subprocess
import time

# --- Configuration des chemins ---
# Modifie ce chemin si ton dépôt cantus est ailleurs
repo_dir = r"C:\Users\cypri\Downloads\cantus" 
source_images_dir = r"C:\Users\cypri\Downloads\images"
dest_images_dir = os.path.join(repo_dir, "images")

def run_git_command(command, cwd):
    """Exécute une commande git dans le dossier spécifié."""
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    if result.returncode != 0:
        print(f"Erreur avec la commande {' '.join(command)} :")
        print(result.stderr)
    return result.returncode == 0

def main():
    # 1. Créer le dossier 'images' à la racine de cantus s'il n'existe pas
    if not os.path.exists(dest_images_dir):
        os.makedirs(dest_images_dir)
        print(f"Dossier créé : {dest_images_dir}")

    # 2. Lister le contenu du dossier source
    elements = os.listdir(source_images_dir)
    
    for item in elements:
        source_path = os.path.join(source_images_dir, item)
        dest_path = os.path.join(dest_images_dir, item)
        
        print(f"\n--- Traitement de : {item} ---")
        
        # Copie du dossier ou fichier
        if os.path.isdir(source_path):
            shutil.copytree(source_path, dest_path, dirs_exist_ok=True)
        else:
            shutil.copy2(source_path, dest_path)
            
        print(f"Copie locale terminée pour {item}.")
        
        # Commandes Git
        print("Ajout à Git (git add)...")
        run_git_command(["git", "add", f"images/{item}"], repo_dir)
        
        print("Création du commit (git commit)...")
        run_git_command(["git", "commit", "-m", f"Ajout du dossier/fichier images/{item}"], repo_dir)
        
        print("Envoi vers GitHub (git push)...")
        success = run_git_command(["git", "push"], repo_dir)
        
        if success:
            print(f"✅ {item} envoyé avec succès !")
        else:
            print(f"❌ Échec de l'envoi pour {item}. Arrêt du script pour éviter les conflits.")
            break
            
        # Courte pause pour laisser souffler l'API et la connexion
        time.sleep(2)

    print("\nTransfert terminé !")

if __name__ == "__main__":
    main()