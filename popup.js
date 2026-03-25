// ==========================================
// CONFIGURATION ET CONSTANTES
// ==========================================
const CONFIG = {
  selectors: {
    input: '#urlInput',
    button: '#loadBtn',
    content: '#content',
    themeToggle: '#themeToggle',
    metadata: '#metadata',
    prevBtnTop: '#prevBtnTop',
    nextBtnTop: '#nextBtnTop',
    prevBtnBottom: '#prevBtnBottom',
    nextBtnBottom: '#nextBtnBottom'
  },
  storageKeyUrl: 'ao3_last_url',
  storageKeyHtml: 'ao3_last_html',
  storageKeyTheme: 'ao3_theme',
  storageKeyScroll: 'ao3_scroll_pos',
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
    this.themeToggle = document.querySelector(CONFIG.selectors.themeToggle);
    this.metadata = document.querySelector(CONFIG.selectors.metadata);
    this.prevBtnTop = document.querySelector(CONFIG.selectors.prevBtnTop);
    this.nextBtnTop = document.querySelector(CONFIG.selectors.nextBtnTop);
    this.prevBtnBottom = document.querySelector(CONFIG.selectors.prevBtnBottom);
    this.nextBtnBottom = document.querySelector(CONFIG.selectors.nextBtnBottom);
    
    this.initTheme();
  }

  initTheme() {
    // Restaurer le thème depuis le storage de l'extension
    chrome.storage.local.get([CONFIG.storageKeyTheme], (result) => {
      if (result[CONFIG.storageKeyTheme] === 'dark') {
        document.body.classList.add('dark-theme');
      }
    });

    this.themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      const isDark = document.body.classList.contains('dark-theme');
      chrome.storage.local.set({ [CONFIG.storageKeyTheme]: isDark ? 'dark' : 'light' });
    });
  }

  showLoading() {
    this.content.innerHTML = '<p class="status-msg">⏳ Chargement de l\'histoire en cours...</p>';
    this.metadata.innerHTML = '';
    
    if (this.prevBtnTop) this.prevBtnTop.style.display = 'none';
    if (this.nextBtnTop) this.nextBtnTop.style.display = 'none';
    if (this.prevBtnBottom) this.prevBtnBottom.style.display = 'none';
    if (this.nextBtnBottom) this.nextBtnBottom.style.display = 'none';
    
    this.button.disabled = true;
  }

  showError(message) {
    this.content.innerHTML = `<p class="error-msg">❌ <strong>Erreur :</strong> ${message}</p>`;
    this.button.disabled = false;
  }

  displayContent(data) {
    // Supporte l'ancien format (string) et le nouveau (objet JSON avec les stats et liens)
    const htmlContent = typeof data === 'string' ? data : data.html;
    this.content.innerHTML = htmlContent;

    if (typeof data === 'object') {
      if (data.stats) {
        this.metadata.innerHTML = data.stats;
      }
      
      const showPrev = data.prevUrl ? 'block' : 'none';
      const showNext = data.nextUrl ? 'block' : 'none';

      if (this.prevBtnTop) {
        this.prevBtnTop.style.display = showPrev;
        this.prevBtnTop.dataset.url = data.prevUrl || '';
      }
      if (this.prevBtnBottom) {
        this.prevBtnBottom.style.display = showPrev;
        this.prevBtnBottom.dataset.url = data.prevUrl || '';
      }

      if (this.nextBtnTop) {
        this.nextBtnTop.style.display = showNext;
        this.nextBtnTop.dataset.url = data.nextUrl || '';
      }
      if (this.nextBtnBottom) {
        this.nextBtnBottom.style.display = showNext;
        this.nextBtnBottom.dataset.url = data.nextUrl || '';
      }
    }

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
    // Nettoyage agressif direct sur la chaîne STRING de caractères avant l'analyse DOMParser
    // Cela empêche Chrome d'intercepter des balises preloads (ex: <link rel="preload">) et de déclencher des requêtes
    const safeHtmlText = htmlText
      .replace(/<link\b[^>]*>/gi, '') // Supprime les liens (stylesheets, preloads)
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '') // Supprime les scripts
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''); // Supprime les styles

    const parser = new DOMParser();
    const doc = parser.parseFromString(safeHtmlText, 'text/html');

    // Récupérations des Stats (si présentes)
    const stats = [];
    
    // Chapitre actuel
    const selectedOption = doc.querySelector('#selected_id option[selected="selected"]');
    if (selectedOption) {
      stats.push(`${selectedOption.textContent}`);
    } else {
      const workTitle = doc.querySelector('h2.title');
      if (workTitle) stats.push(`${workTitle.textContent.trim()}`);
    }

    const words = doc.querySelector('dd.words');
    const chapters = doc.querySelector('dd.chapters');
    const kudos = doc.querySelector('dd.kudos');
    if (chapters) stats.push(`Ch: ${chapters.textContent}`);
    if (words) stats.push(`Mots: ${words.textContent}`);
    if (kudos) stats.push(`Kudos: ${kudos.textContent}`);

    // Récupération des liens de chapitre
    const nextBtn = doc.querySelector('.chapter.next a');
    const prevBtn = doc.querySelector('.chapter.previous a');
    const nextUrl = nextBtn ? "https://archiveofourown.org" + nextBtn.getAttribute('href') : null;
    const prevUrl = prevBtn ? "https://archiveofourown.org" + prevBtn.getAttribute('href') : null;

    // Extraction de l'histoire (#chapters en prio pour éviter le résumé global qui a aussi la classe .userstuff)
    const storyContainer = doc.querySelector('#chapters') || doc.querySelector('#workskin') || doc.querySelector('.userstuff');
    
    if (!storyContainer) {
      console.error("[Stealth Reader] HTML reçu:", htmlText.substring(0, 300));
      throw new Error("Impossible d'isoler le contenu de l'histoire. URL invalide, bloquée par AO3 ou erreur inattendue.");
    }
    // Nettoyage des scripts et éléments non désirés pour éviter les erreurs CSP et de sécurité
    const scriptsAndStyles = storyContainer.querySelectorAll('script, style, iframe, link, object, embed');
    scriptsAndStyles.forEach(el => el.remove());
    // Amélioration de l'affichage / Discrétion
    // On garde la classe .chapter.preface car elle contient souvent le titre et les notes du chapitre.
    const elementsToRemove = storyContainer.querySelectorAll('.landmark');
    elementsToRemove.forEach(el => el.remove());

    return {
      html: storyContainer.innerHTML,
      stats: stats.join(' | '),
      nextUrl: nextUrl,
      prevUrl: prevUrl
    };
  }
}

// ==========================================
// CONTROLEUR PRINCIPAL
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  const ui = new UIManager();

  // Restauration de la dernière URL, du contenu et du scroll
  chrome.storage.local.get([CONFIG.storageKeyUrl, CONFIG.storageKeyHtml, CONFIG.storageKeyScroll], (result) => {
    if (result[CONFIG.storageKeyUrl]) {
      ui.inputValue = result[CONFIG.storageKeyUrl];
    }
    
    // Si on a du contenu en cache, on l'affiche directement sans re-fetch
    if (result[CONFIG.storageKeyHtml]) {
      ui.displayContent(result[CONFIG.storageKeyHtml]);

      // Repositionner le scroll une fois le HTML injecté dans le DOM
      if (result[CONFIG.storageKeyScroll]) {
        setTimeout(() => {
          const pos = result[CONFIG.storageKeyScroll];
          window.scrollTo(0, pos);
          document.body.scrollTop = pos;
          document.documentElement.scrollTop = pos;
        }, 100);
      }
    }
  });

  // Action de chargement (Fetch frais)
  document.getElementById('loadBtn').addEventListener('click', async () => {
    const url = ui.inputValue;
    if (!url) return;

    ui.showLoading();

    try {
      const storyData = await AO3Service.fetchStory(url);
      ui.displayContent(storyData);
      
      // Remise à zéro tout en haut
      window.scrollTo(0, 0);
      document.body.scrollTop = 0;
      document.documentElement.scrollTop = 0;
      
      // On sauvegarde l'URL, le contenu HTML et on reset le scroll
      chrome.storage.local.set({ 
        [CONFIG.storageKeyUrl]: url,
        [CONFIG.storageKeyHtml]: storyData,
        [CONFIG.storageKeyScroll]: 0
      });

    } catch (error) {
      console.error("[Stealth Reader] Erreur:", error);
      ui.showError(error.message);
    }
  });

  // Gestion des clics sur Chapitre Suivant / Précédent
  const navigateTo = (url) => {
    if (url) {
      ui.inputValue = url;
      document.getElementById('loadBtn').click(); // Simule un chargement auto
    }
  };

  const bindNavBtn = (id) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', function() { navigateTo(this.dataset.url); });
  };

  bindNavBtn('prevBtnTop');
  bindNavBtn('nextBtnTop');
  bindNavBtn('prevBtnBottom');
  bindNavBtn('nextBtnBottom');

  // Sauvegarde automatique et fluide du défilement
  let scrollTimeout;
  document.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const currentScroll = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
      chrome.storage.local.set({ [CONFIG.storageKeyScroll]: currentScroll });
    }, 200);
  }, true); // "true" permet de capturer l'événement même si l'overflow est sur le body
});