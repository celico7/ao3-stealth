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
    nextBtnBottom: '#nextBtnBottom',
    readerView: '#reader-view',
    tabBtns: '.tab-btn',
    tabContents: '.tab-content',
    autoList: '#reading-list',
    autoLoading: '#auto-loading'
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
    this.readerView = document.querySelector(CONFIG.selectors.readerView);
    
    this.prevBtns = [document.querySelector(CONFIG.selectors.prevBtnTop), document.querySelector(CONFIG.selectors.prevBtnBottom)].filter(Boolean);
    this.nextBtns = [document.querySelector(CONFIG.selectors.nextBtnTop), document.querySelector(CONFIG.selectors.nextBtnBottom)].filter(Boolean);
    
    this.tabBtns = document.querySelectorAll(CONFIG.selectors.tabBtns);
    this.tabContents = document.querySelectorAll(CONFIG.selectors.tabContents);
    this.autoList = document.querySelector(CONFIG.selectors.autoList);
    this.autoLoading = document.querySelector(CONFIG.selectors.autoLoading);
    
    this.autoConfirm = document.querySelector('#auto-confirm');
    this.autoPseudoName = document.querySelector('#auto-pseudo-name');
    this.confirmCheckbox = document.querySelector('#confirm-pseudo-checkbox');
    this.fetchHistoryBtn = document.querySelector('#fetch-history-btn');
    this.currentPseudo = '';

    this.initTheme();
    this.initTabs();
    this.initUserGreeting();
  }

  async initUserGreeting() {
    this.userGreeting = document.querySelector('#user-greeting');
    this.topbarPseudoName = document.querySelector('#topbar-pseudo-name');
    try {
      const pseudo = await AO3Service.fetchUserPseudo();
      if (pseudo && this.userGreeting && this.topbarPseudoName) {
        this.topbarPseudoName.textContent = pseudo;
        this.userGreeting.style.display = 'block';
      }
    } catch (e) {
      // Ignorer silencieusement si l'utilisateur n'est pas connecté
    }
  }

  initTabs() {
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.dataset.target);
      });
    });

    this.confirmCheckbox.addEventListener('change', (e) => {
      this.fetchHistoryBtn.disabled = !e.target.checked;
    });

    this.fetchHistoryBtn.addEventListener('click', () => {
      this.runHistoryFetch();
    });
  }

  switchTab(targetId) {
    this.tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.target === targetId);
    });
    this.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === targetId);
    });

    if (targetId === 'auto-mode') {
      this.readerView.style.display = 'none';
      if (this.autoList.innerHTML === '') {
        this.loadAutoHistory();
      }
    } else {
      if (this.content.innerHTML !== '') {
        this.readerView.style.display = 'block';
      }
    }
  }

  async loadAutoHistory() {
    this.autoLoading.style.display = 'block';
    this.autoLoading.textContent = "Recherche de l'utilisateur connecté...";
    this.autoList.innerHTML = '';
    this.autoConfirm.style.display = 'none';

    try {
      const pseudo = await AO3Service.fetchUserPseudo();
      this.currentPseudo = pseudo;
      
      this.autoLoading.style.display = 'none';
      this.autoConfirm.style.display = 'block';
      this.autoPseudoName.textContent = pseudo;
      this.confirmCheckbox.checked = false;
      this.fetchHistoryBtn.disabled = true;

    } catch (error) {
      this.autoLoading.textContent = error.message;
    }
  }

  async runHistoryFetch() {
    this.autoConfirm.style.display = 'none';
    this.autoLoading.style.display = 'block';
    this.autoLoading.textContent = `Récupération de l'historique de ${this.currentPseudo}...`;

    try {
      const readings = await AO3Service.fetchRecentReadings(this.currentPseudo);
      this.autoLoading.style.display = 'none';

      if (readings.length === 0) {
        this.autoList.innerHTML = '<li style="text-align:center;">Aucun historique récent trouvé.</li>';
        return;
      }

      readings.forEach(fic => {
        const li = document.createElement('li');
        li.innerHTML = `
          <span class="fic-title">${fic.title}</span>
          <span class="fic-meta">Auteur: ${fic.author} | Fandom: ${fic.fandom}</span>
        `;
        li.addEventListener('click', () => {
          this.inputValue = fic.url;
          this.switchTab('manual-mode');
          this.button.click(); // Simule le chargement
        });
        this.autoList.appendChild(li);
      });

    } catch (error) {
      this.autoLoading.textContent = error.message;
    }
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

  showLoading() {    this.readerView.style.display = 'block';    this.content.innerHTML = '<p class="status-msg">⏳ Chargement de l\'histoire en cours...</p>';
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
    
    // Nettoyage de sécurité : on retire script, iframe, link
    htmlContent = htmlContent.replace(/<(script|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');

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

  static async getCookieString() {
    return new Promise((resolve) => {
      chrome.cookies.getAll({ domain: CONFIG.domain }, (cookies) => {
        resolve(cookies.map(c => `${c.name}=${c.value}`).join('; '));
      });
    });
  }

  static async fetchSecure(url) {
    const cookieString = await this.getCookieString();
    return fetch(url, {
      headers: {
        'Cookie': cookieString,
        'User-Agent': navigator.userAgent
      }
    });
  }

  static async fetchUserPseudo() {
    const response = await this.fetchSecure('https://archiveofourown.org/');
    if (!response.ok) throw new Error("Impossible d'accéder à AO3.");
    
    const htmlText = await response.text();
    const cleanHtml = htmlText
      .replace(/<head[\s\S]*?<\/head>/gi, '<head></head>')
      .replace(/<(script|style|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');
      
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = cleanHtml;
    
    // Le menu utilisateur AO3 a un lien vers le profil (ex:href="/users/MonPseudo")
    const profileLink = doc.querySelector('#greeting a[href^="/users/"]');
    if (!profileLink) {
      throw new Error("Vous n'êtes pas connecté à AO3. Connectez-vous sur votre navigateur en cochant \"Remember Me\". Cette extension utilise votre cookie de connexion du navigateur, !elle n'est pas mémorisé par l'extension elle-même, cette pratique est 100% safe!.");
    }
    
    const href = profileLink.getAttribute('href'); 
    const pseudo = href.split('/')[2];
    return pseudo;
  }

  static async fetchRecentReadings(pseudo) {
    const response = await this.fetchSecure(`https://archiveofourown.org/users/${pseudo}/readings`);
    if (!response.ok) throw new Error("Impossible d'accéder à l'historique de lecture.");
    
    const htmlText = await response.text();
    const cleanHtml = htmlText
      .replace(/<head[\s\S]*?<\/head>/gi, '<head></head>')
      .replace(/<(script|style|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, '');
      
    const doc = document.implementation.createHTMLDocument('');
    doc.documentElement.innerHTML = cleanHtml;
    
    // Parser les 3 à 5 dernières lectures
    const worksNodes = Array.from(doc.querySelectorAll('li.work.blurb.group')).slice(0, 5);
    
    const readingList = worksNodes.map(work => {
      const titleLink = work.querySelector('h4.heading a:first-child');
      const authorLink = work.querySelector('h4.heading a[rel="author"]');
      const fandomLink = work.querySelector('h5.fandoms a');

      return {
        title: titleLink ? titleLink.textContent.trim() : 'Inconnu',
        url: titleLink ? `https://archiveofourown.org${titleLink.getAttribute('href')}` : null,
        author: authorLink ? authorLink.textContent.trim() : 'Anonyme',
        fandom: fandomLink ? fandomLink.textContent.trim() : ''
      };
    }).filter(work => work.url); // Exclut les fictions lockées/supprimées sans url

    return readingList;
  }

  /**
   * Récupère et extrait le contenu de l'histoire.
   */
  static async fetchStory(rawUrl) {
    if (!this.isValidURL(rawUrl)) {
      throw new Error(`Veuillez entrer une URL valide pointant vers une œuvre (works) ou un chapitre (chapters) sur ${CONFIG.domain}.`);
    }

    const fetchedUrl = this.prepareURL(rawUrl);
    const response = await this.fetchSecure(fetchedUrl);

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
        .replace(/<(script|iframe|link)\b[^>]*>([\s\S]*?<\/\1>)?/gi, ''); 

      const parser = new DOMParser();
      const doc = parser.parseFromString(cleanHtml, 'text/html');
      // --- Extractions principales (Titre, Auteur) ---
      const headingTitleNode = doc.querySelector('h2.title.heading');
      const headingAuthorNodes = doc.querySelectorAll('h3.byline.heading a[rel="author"]');
    // Fallback: sur certaines pages ça peut être juste 'h2.title'
    let ficTitleStr = '';
    if (headingTitleNode) {
      ficTitleStr = headingTitleNode.textContent.trim();
    } else {
      const workTitle = doc.querySelector('h2.title');
      if (workTitle) ficTitleStr = workTitle.textContent.trim();
    }

    let authorStr = '';
    if (headingAuthorNodes && headingAuthorNodes.length > 0) {
      authorStr = Array.from(headingAuthorNodes).map(a => a.textContent.trim()).join(', ');
    } else {
      // Autre structure AO3 possible pour les auteurs (page profil, bookmarks, etc)
      const ddAuthors = doc.querySelectorAll('dd.authors a[rel="author"]');
      if (ddAuthors && ddAuthors.length > 0) {
        authorStr = Array.from(ddAuthors).map(a => a.textContent.trim()).join(', ');
      }
    }

    // Reconstruction du Titre principal "Titre by Auteur"
    const headerTitle = (ficTitleStr && authorStr) ? 
        `${ficTitleStr} par ${authorStr}` : 
        (ficTitleStr || 'Fiction en cours');
        
    // Stats second ligne
    const stats = [];
    stats.push(`<strong>${headerTitle}</strong><br/>`);

    const selectedOption = doc.querySelector('#selected_id option[selected="selected"]');
    if (selectedOption) {
      stats.push(`<strong>${selectedOption.textContent}</strong>`);
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

    // --- Extractions des tags ---
    let tagsHTML = '';
    const dlWorkMetaGroup = doc.querySelector('dl.work.meta.group');
    if (dlWorkMetaGroup) {
      // Enlever les stats du bloc tags pour éviter les doublons
      dlWorkMetaGroup.querySelectorAll('.stats').forEach(el => el.remove());

      tagsHTML = `
        <details class="stealth-tags-widget" style="margin-top: 5px;">
          <summary style="cursor: pointer; font-size: 0.9em; font-weight: bold; color: var(--status-color);">Voir tags >></summary>
          <div class="tags-content">
              ${dlWorkMetaGroup.innerHTML}
          </div>
        </details>
      `;
    }

    return {
      html: tagsHTML + storyContainer.innerHTML,
      stats: stats[0] + stats.slice(1).join(' | '),
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
        // Tente de scroller plusieurs fois le temps que le popup et le DOM s'ajustent
        let attempts = 0;
        const readerView = document.querySelector('#reader-view');
        const tryScroll = () => {
          if (readerView) readerView.scrollTo({ top: result[CONFIG.storageKeyScroll], behavior: 'instant' });
          if (++attempts < 5) setTimeout(tryScroll, 100);
        };
        tryScroll();
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

      const readerView = document.querySelector('#reader-view');
      if (readerView) readerView.scrollTo({ top: 0, behavior: 'instant' });

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
  let isRestoring = true; // Empêche l'écrasement de la sauvegarde lors de l'ouverture

  setTimeout(() => isRestoring = false, 500); // Laisse le temps au popup de s'afficher

  const readerView = document.querySelector('#reader-view');
  if (readerView) {
    readerView.addEventListener('scroll', () => {
      if (isRestoring) return;
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(() => {
        chrome.storage.local.set({ [CONFIG.storageKeyScroll]: readerView.scrollTop });
      }, 200);
    });
  }
});