// ==========================================
// CONFIGURATION ET CONSTANTES
// ==========================================
const CONFIG = {
  selectors: {
    input: '#urlInput',
    button: '#loadBtn',
    content: '#content'
  },
  storageKey: 'ao3_last_url',
  domain: 'archiveofourown.org'
};

// ==========================================
// SERVICES DOM (Gestion de l'interface)
// ==========================================
class UIManager {
  constructor() {
    this.input = document.querySelector(CONFIG.selectors.input);
    this.button = document.querySelector(CONFIG.selectors.button);
    this.content = document.querySelector(CONFIG.selectors.content);
  }

  showLoading() {
    this.content.innerHTML = '<p class="status-msg">⏳ Chargement de l\'histoire en cours...</p>';
    this.button.disabled = true;
  }

  showError(message) {
    this.content.innerHTML = `<p class="error-msg">❌ <strong>Erreur :</strong> ${message}</p>`;
    this.button.disabled = false;
  }

  displayContent(htmlString) {
    // L'utilisation de innerHTML est ici protégée par la CSP restrictive du Manifest V3 
    // et le fait qu'AO3 filtre déjà très strictement le HTML des auteurs.
    this.content.innerHTML = htmlString;
    this.button.disabled = false;
  }

  get inputValue() {
    return this.input.value.trim();
  }

  set inputValue(val) {
    this.input.value = val;
  }
}

// ==========================================
// SERVICES API (Accès et Parsing AO3)
// ==========================================
class AO3Service {
  /**
   * Valide l'URL fournie.
   */
  static isValidURL(url) {
    try {
      const parsedUrl = new URL(url);
      return parsedUrl.hostname.includes(CONFIG.domain) 
          && (parsedUrl.pathname.includes('/works/') || parsedUrl.pathname.includes('/chapters/'));
    } catch {
      return false;
    }
  }

  /**
   * Prépare l'URL (force le bypass du warning adulte).
   */
  static prepareURL(rawUrl) {
    const url = new URL(rawUrl);
    url.searchParams.set('view_adult', 'true'); // Évite le message d'avertissement "Contenu adulte"
    return url.toString();
  }

  /**
   * Récupère et extrait le contenu de l'histoire.
   */
  static async fetchStory(rawUrl) {
    if (!this.isValidURL(rawUrl)) {
      throw new Error(`Veuillez entrer une URL valide pointant vers une œuvre (works) ou un chapitre (chapters) sur ${CONFIG.domain}.`);
    }

    const fetchedUrl = this.prepareURL(rawUrl);

    // L'ajout de credentials: 'include' permet d'utiliser les cookies du navigateur.
    // C'est vital pour les fictions restreintes (accessibles uniquement aux utilisateurs connectés).
    const response = await fetch(fetchedUrl, {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
        throw new Error(`Échec de la connexion au serveur (Statut HTTP : ${response.status}).`);
    }

    const htmlText = await response.text();
    return this.parseHTML(htmlText);
  }

  /**
   * Isole le texte de la fiction depuis la structure HTML.
   */
  static parseHTML(htmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');

    // 1. Vérification des cas bloquants connus d'AO3
    if (doc.querySelector('body').textContent.includes('only available to registered users')) {
      throw new Error(`Cette fiction est restreinte. Vous devez d'abord vous connecter à AO3 sur votre navigateur Chrome, puis réessayer.`);
    }

    if (doc.querySelector('body').textContent.includes('This work could have adult content') && !doc.querySelector('#workskin')) {
      throw new Error(`Le système de bypass adulte a échoué. Essayez d'ouvrir la page, de cliquer sur 'Proceed', puis de réessayer.`);
    }

    // 2. Extraction du conteneur de l'histoire
    // #workskin est le conteneur principal utilisé par AO3 pour englober la fiction.
    const storyContainer = doc.querySelector('#workskin');
    
    if (!storyContainer) {
      throw new Error("Structure AO3 non reconnue ou page introuvable.");
    }

    // 3. Amélioration de l'affichage / Discrétion
    // On peut retirer certains éléments pour rendre la lecture plus neutre et "stealth".
    const elementsToRemove = storyContainer.querySelectorAll('h3.landmark, .chapter.preface');
    elementsToRemove.forEach(el => el.remove());

    return storyContainer.innerHTML;
  }
}

// ==========================================
// CONTROLEUR PRINCIPAL
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const ui = new UIManager();

  // Restauration de la dernière URL
  chrome.storage.local.get([CONFIG.storageKey], (result) => {
    if (result[CONFIG.storageKey]) {
      ui.inputValue = result[CONFIG.storageKey];
    }
  });

  // Action de chargement
  document.getElementById('loadBtn').addEventListener('click', async () => {
    const url = ui.inputValue;
    if (!url) return;

    ui.showLoading();
    chrome.storage.local.set({ [CONFIG.storageKey]: url });

    try {
      const storyHTML = await AO3Service.fetchStory(url);
      ui.displayContent(storyHTML);
    } catch (error) {
      console.error("[Stealth Reader] Erreur:", error);
      ui.showError(error.message);
    }
  });
});