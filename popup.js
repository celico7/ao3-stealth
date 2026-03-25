// ==========================================
// CONFIGURATION ET CONSTANTES
// ==========================================
const CONFIG = {
  selectors: {
    input: '#urlInput',
    button: '#loadBtn',
    content: '#content'
  },
  storageKeyUrl: 'ao3_last_url',
  storageKeyHtml: 'ao3_last_html',
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

    // 1. Récupération explicite des cookies de session AO3 de l'utilisateur
    // Contourne les blocages de sécurité "SameSite" et "Cross-Origin" de Chrome 
    // qui empêchent souvent `credentials: 'include'` de fonctionner correctement en Manifest V3.
    const cookieString = await new Promise((resolve) => {
      chrome.cookies.getAll({ domain: CONFIG.domain }, (cookies) => {
        resolve(cookies.map(c => `${c.name}=${c.value}`).join('; '));
      });
    });

    // 2. Fetch de la page en injectant les cookies en dur dans les en-têtes
    const response = await fetch(fetchedUrl, {
      method: 'GET',
      headers: {
        'Cookie': cookieString, // Injection manuelle
        'User-Agent': navigator.userAgent // Garder un footprint naturel
      }
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

    // 1. Vérification des cas bloquants / Captchas intraitables
    if (doc.body && doc.body.textContent.includes('only available to registered users')) {
      throw new Error(`Cette fiction est restreinte. Vous devez d'abord vous connecter à AO3 sur votre navigateur Chrome, puis réessayer.`);
    }

    if (doc.body && doc.body.textContent.includes('This work could have adult content') && !doc.querySelector('#workskin')) {
      throw new Error(`Le système de bypass adulte a échoué. Essaye d'ouvrir la page, de cliquer sur 'Proceed', puis de réessayer.`);
    }

    if (doc.title.includes('Just a moment...') || (doc.body && doc.body.textContent.includes('Cloudflare'))) {
       throw new Error(`Archive of Our Own a bloqué la requête via Cloudflare (protection anti-bot). Essaye de naviguer un peu sur AO3 dans un autre onglet puis réessaye.`);
    }

    // Si on a un 404
    if (doc.title.includes('Error 404')) {
      throw new Error(`L'histoire n'existe pas ou a été supprimée (Erreur 404).`);
    }

    // 2. Extraction du conteneur de l'histoire
    // #workskin est le conteneur principal utilisé par AO3 pour englober la fiction.
    const storyContainer = doc.querySelector('#workskin');
    
    if (!storyContainer) {
      console.error("[Stealth Reader] Contenu de la page reçue (extrait):", htmlText.substring(0, 500));
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

  // Restauration de la dernière URL et du dernier contenu
  chrome.storage.local.get([CONFIG.storageKeyUrl, CONFIG.storageKeyHtml], (result) => {
    if (result[CONFIG.storageKeyUrl]) {
      ui.inputValue = result[CONFIG.storageKeyUrl];
    }
    
    // Si on a du contenu en cache, on l'affiche directement sans re-fetch
    if (result[CONFIG.storageKeyHtml]) {
      ui.displayContent(result[CONFIG.storageKeyHtml]);
    }
  });

  // Action de chargement (Fetch frais)
  document.getElementById('loadBtn').addEventListener('click', async () => {
    const url = ui.inputValue;
    if (!url) return;

    ui.showLoading();

    try {
      const storyHTML = await AO3Service.fetchStory(url);
      ui.displayContent(storyHTML);
      
      // On sauvegarde l'URL ET le contenu HTML extrait pour la prochaine ouverture
      chrome.storage.local.set({ 
        [CONFIG.storageKeyUrl]: url,
        [CONFIG.storageKeyHtml]: storyHTML
      });

    } catch (error) {
      console.error("[Stealth Reader] Erreur:", error);
      ui.showError(error.message);
    }
  });
});