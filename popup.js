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
    
    this.prevBtns = [document.querySelector(CONFIG.selectors.prevBtnTop), document.querySelector(CONFIG.selectors.prevBtnBottom)].filter(Boolean);
    this.nextBtns = [document.querySelector(CONFIG.selectors.nextBtnTop), document.querySelector(CONFIG.selectors.nextBtnBottom)].filter(Boolean);
    
    this.initTheme();
  }

  initTheme() {
    chrome.storage.local.get([CONFIG.storageKeyTheme], (result) => {
      if (result[CONFIG.storageKeyTheme] === 'dark') document.body.classList.add('dark-theme');
    });

    this.themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('dark-theme');
      chrome.storage.local.set({ [CONFIG.storageKeyTheme]: document.body.classList.contains('dark-theme') ? 'dark' : 'light' });
    });
  }

  showLoading() {
    this.content.innerHTML = '<p class="status-msg">⏳ Chargement de l\'histoire en cours...</p>';
    this.metadata.innerHTML = '';
    
    this.prevBtns.forEach(btn => btn.style.display = 'none');
    this.nextBtns.forEach(btn => btn.style.display = 'none');
    
    this.button.disabled = true;
  }

  showError(message) {
    this.content.innerHTML = `<p class="error-msg">❌ <strong>Erreur :</strong> ${message}</p>`;
    this.button.disabled = false;
  }

  displayContent(data) {
    let htmlContent = typeof data === 'string' ? data : data.html;
    
    // Nettoyage de sécurité : on retire script, style, iframe, link
    htmlContent = htmlContent.replace(/<(script|style|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');

    this.content.innerHTML = htmlContent;

    if (typeof data === 'object') {
      if (data.stats) this.metadata.innerHTML = data.stats;
      
      this.prevBtns.forEach(btn => {
        btn.style.display = data.prevUrl ? 'block' : 'none';
        btn.dataset.url = data.prevUrl || '';
      });

      this.nextBtns.forEach(btn => {
        btn.style.display = data.nextUrl ? 'block' : 'none';
        btn.dataset.url = data.nextUrl || '';
      });
    }

    this.button.disabled = false;
  }

  get inputValue() { return this.input.value.trim(); }
  set inputValue(val) { this.input.value = val; }
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
    const cleanHtml = htmlText
      .replace(/<head[\s\S]*?<\/head>/gi, '<head></head>')
      .replace(/<(script|style|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');

    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = cleanHtml;

    // Stats
    const stats = [];
    const selectedOption = doc.querySelector('#selected_id option[selected="selected"]');
    if (selectedOption) {
      stats.push(selectedOption.textContent);
    } else {
      const workTitle = doc.querySelector('h2.title');
      if (workTitle) stats.push(workTitle.textContent.trim());
    }

    const { words, chapters, kudos } = {
      words: doc.querySelector('dd.words'),
      chapters: doc.querySelector('dd.chapters'),
      kudos: doc.querySelector('dd.kudos')
    };

    if (chapters) stats.push(`Ch: ${chapters.textContent}`);
    if (words) stats.push(`Mots: ${words.textContent}`);
    if (kudos) stats.push(`Kudos: ${kudos.textContent}`);

    // Navigation urls
    const getUrl = sel => {
      const el = doc.querySelector(sel);
      return el ? `https://${CONFIG.domain}${el.getAttribute('href')}` : null;
    };

    const storyContainer = doc.querySelector('#chapters') || doc.querySelector('#workskin') || doc.querySelector('.userstuff');
    if (!storyContainer) throw new Error("Impossible d'isoler le contenu de l'histoire. URL invalide ou bloquée.");

    storyContainer.querySelectorAll('object, embed, .landmark').forEach(el => el.remove());

    return {
      html: storyContainer.innerHTML,
      stats: stats.join(' | '),
      nextUrl: getUrl('.chapter.next a'),
      prevUrl: getUrl('.chapter.previous a')
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
    
    if (result[CONFIG.storageKeyHtml]) {
      const cacheHtmlString = typeof result[CONFIG.storageKeyHtml] === 'string' 
        ? result[CONFIG.storageKeyHtml] 
        : (result[CONFIG.storageKeyHtml].html || '');
      
      if (/<script/i.test(cacheHtmlString) || cacheHtmlString.match(/jquery|livevalidation/i)) {
        chrome.storage.local.remove([CONFIG.storageKeyHtml, CONFIG.storageKeyScroll]);
        return; 
      } 
      
      ui.displayContent(result[CONFIG.storageKeyHtml]);

      if (result[CONFIG.storageKeyScroll]) {
        setTimeout(() => window.scrollTo({ top: result[CONFIG.storageKeyScroll], behavior: 'instant' }), 100);
      }
    }
  });

  // Action de chargement
  document.getElementById('loadBtn').addEventListener('click', async () => {
    const url = ui.inputValue;
    if (!url) return;

    ui.showLoading();

    try {
      const storyData = await AO3Service.fetchStory(url);
      ui.displayContent(storyData);
      
      window.scrollTo({ top: 0, behavior: 'instant' });
      
      chrome.storage.local.set({ 
        [CONFIG.storageKeyUrl]: url,
        [CONFIG.storageKeyHtml]: storyData,
        [CONFIG.storageKeyScroll]: 0
      });

    } catch (error) {
      ui.showError(error.message);
    }
  });

  // Gestion des clics sur Chapitre Suivant / Précédent
  const navigateTo = (url) => {
    if (url) {
      ui.inputValue = url;
      document.getElementById('loadBtn').click();
    }
  };

  ['prevBtnTop', 'nextBtnTop', 'prevBtnBottom', 'nextBtnBottom'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', function() { navigateTo(this.dataset.url); });
  });

  // Sauvegarde automatique du défilement
  let scrollTimeout;
  document.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      chrome.storage.local.set({ [CONFIG.storageKeyScroll]: window.scrollY || document.documentElement.scrollTop });
    }, 200);
  }, true); 
});