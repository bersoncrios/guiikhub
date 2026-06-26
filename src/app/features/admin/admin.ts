import { Component, signal, computed, effect, inject, ElementRef, ViewChild, HostListener, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Swal from 'sweetalert2';
import { environment } from '../../../environments/environment';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { DbService } from '../../core/db/db.service';
import { BlogSettings, ShopItem, PautaContract } from '../../core/models/interfaces';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class AdminComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  // Navigation
  readonly activeTab = signal<'posts' | 'customize' | 'profile' | 'new-post' | 'collabs' | 'monetization' | 'gamification' | 'spotlight' | 'sys-admin' | 'shop' | 'pods'>('gamification');
  readonly sysAdminSubTab = signal<'overview' | 'users' | 'badges' | 'shop' | 'blacklist' | 'reports'>('overview');
  readonly monetizationSubTab = signal<'sponsors' | 'crowdfunding'>('sponsors');
  readonly shopSubTab = signal<'frames' | 'tags' | 'themes'>('frames');
  readonly mobileNavOpen = signal(false);
  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav() { this.mobileNavOpen.set(false); }

  // Spotlight Bidding variables
  selectedArticleForSpotlightId = '';
  spotlightBidAmount = 10;
  timeLeftString = '';
  private timerIntervalId: any = null;

  // Sys-Admin management variables
  sysAdminGrantUserId = '';
  sysAdminGrantAmount = 10;
  sysAdminGrantDescription = 'Bonificação administrativa';

  // Blacklist moderation variables
  newBannedWord = '';
  isSavingBannedWord = false;
  bannedWordSearchQuery = signal<string>('');

  readonly filteredBannedWords = computed(() => {
    const list = this.db.bannedWords();
    const query = this.bannedWordSearchQuery().toLowerCase().trim();
    if (!query) return list;
    return list.filter(item => item.word.toLowerCase().includes(query));
  });

  // Crowdfunding Pauta variables
  newContractTitle = '';
  newContractDescription = '';
  newContractGoal = 100;
  isSavingContract = false;
  selectedContractIdForPost = signal<string | null>(null);


  readonly fundedContracts = computed(() => {
    const me = this.db.currentUser();
    if (!me) return [];
    return this.db.pautaContracts().filter(c => c.creatorId === me.id && c.status === 'funded');
  });

  readonly myContracts = computed(() => {
    const me = this.db.currentUser();
    if (!me) return [];
    return this.db.pautaContracts().filter(c => c.creatorId === me.id);
  });

  // Dynamic Badge variables
  badgeName = '';
  badgeDescription = '';
  badgeXpRequirement = 100;
  badgeType: 'xp' | 'event' | 'special' | 'staff' | 'milestone' | 'custom' = 'xp';
  badgeTargetDate = '';
  badgeIconUrl = '';
  badgeRewardBits = 0;
  isUploadingBadgeIcon = false;

  // Shop Variables
  newItemName = '';
  newItemDescription = '';
  newItemCost = 100;
  newItemCategory: 'frame' | 'tag' | 'theme' | 'other' = 'frame';
  newItemValue = '';
  newItemImageUrl = '';
  isCreatingShopItem = false;

  // Dynamic frame/theme creator fields
  useCustomStyling = false; // flag to toggle custom vs technical styling

  // Custom Frame fields
  frameColor1 = '#00f0ff';
  frameColor2 = '#ff007f';
  frameGlowColor = '#00f0ff';
  frameShape: 'circle' | 'square' = 'circle';
  frameAnimation: 'pulse' | 'rotate' | 'glitch' | 'fire' | 'none' = 'pulse';

  // Custom Theme fields
  themePrimaryColor = '#39ff14';
  themeBgColor = '#020202';
  themeCardBgColor = 'rgba(10, 15, 10, 0.8)';
  themeTextColor = '#e2e8f0';
  themeAccentColor = '#39ff14';
  themeEffect: 'scanlines' | 'matrix' | 'none' = 'scanlines';

  // New Post Form
  newPostTitle = '';
  newPostSummary = '';
  newPostContent = '';
  newPostCoverUrl = '/images/frostbite_cover.png';
  isUploadingCover = false;
  newPostTags = 'Gamer, Geek, Tech';
  newPostSection = '';
  sendNewsletter = false;
  
  // Data Paywall
  newPostIsPaywalled = false;
  newPostPaywallPrice = 2;
  newPostPaywallPreviewPercentage = 40;
  newPostPaywallRequiredBadgeId = '';
  
  // Data Pods Form
  newPodTitle = '';
  newPodDescription = '';
  newPodCoverUrl = '/images/frostbite_cover.png';
  newPodType: 'standard' | 'premium' | 'open_collab' = 'standard';
  newPodPrice = 5;
  isUploadingPodCover = false;
  
  targetBlogId = '';
  isScheduled = false;
  scheduledDateTime = '';

  // Link selector autocomplete
  showLinkSelector = false;
  linkSearchQuery = signal('');
  linkSelectorSelectedIndex = signal(0);
  linkSelectorPosition = { top: 0, left: 0 };

  // Rich Text Editor
  @ViewChild('richEditor') richEditorRef!: ElementRef<HTMLDivElement>;
  readonly editorHasContent = signal(false);

  // Post Editing
  readonly editingArticleId = signal<string | null>(null);

  // --- Editor Sidebar State ---
  editorSidebarTab: 'notes' | 'versions' = 'notes';
  newNoteContent: string = '';

  articleNotes = computed(() => {
    const id = this.editingArticleId();
    if (!id) return [];
    return this.db.articleNotes().filter(n => n.articleId === id);
  });

  articleVersions = computed(() => {
    const id = this.editingArticleId();
    if (!id) return [];
    return this.db.articleVersions().filter(v => v.articleId === id);
  });
  // ----------------------------

  storyPreviewArticle = signal<any | null>(null);

  // Blog Customizer Form
  blogTitle = '';
  blogTagline = '';
  blogPrimary = '';
  blogAccent = '';
  blogBg = '';
  blogCardBg = '';
  blogText = '';
  blogFont: 'Outfit' | 'Space Grotesk' | 'Fira Code' | 'system-ui' = 'Outfit';
  blogLayout: 'grid' | 'list' | 'magazine' = 'grid';
  blogBannerUrl = '';
  isUploadingBlogBanner = false;
  blogSections: string[] = [];
  newSectionName = '';

  // Sponsor Banners
  blogSponsorUrl1 = '';
  blogSponsorLink1 = '';
  isUploadingSponsor1 = false;

  blogSponsorUrl2 = '';
  blogSponsorLink2 = '';
  isUploadingSponsor2 = false;

  // Profile Form
  profileName = '';
  profileBio = '';
  profileAvatar = '';
  isUploadingAvatar = false;
  profileUsername = '';

  // Filter user's own articles and articles posted on their blog
  readonly myArticles = computed(() => {
    const user = this.db.currentUser();
    if (!user) return [];
    return this.db.articles().filter(art => (art.blogId || art.authorId) === user.id);
  });

  // ─── Paginação de Matérias do Criador ───
  readonly postsPage = signal(1);
  readonly postsPageSize = 4;
  readonly paginatedMyArticles = computed(() => {
    const list = this.myArticles();
    const start = (this.postsPage() - 1) * this.postsPageSize;
    return list.slice(start, start + this.postsPageSize);
  });
  readonly postsTotalPages = computed(() => Math.ceil(this.myArticles().length / this.postsPageSize));
  readonly postsPageNumbers = computed(() => {
    const pages: number[] = [];
    const total = this.postsTotalPages();
    const current = this.postsPage();
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  // ─── Paginação do Histórico de Gamificação ───
  readonly logsPage = signal(1);
  readonly logsPageSize = 5;
  readonly paginatedGamificationLogs = computed(() => {
    const list = this.db.gamificationLogs();
    const start = (this.logsPage() - 1) * this.logsPageSize;
    return list.slice(start, start + this.logsPageSize);
  });
  readonly logsTotalPages = computed(() => Math.ceil(this.db.gamificationLogs().length / this.logsPageSize));
  readonly logsPageNumbers = computed(() => {
    const pages: number[] = [];
    const total = this.logsTotalPages();
    const current = this.logsPage();
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  // ─── Paginação de Contas de Usuários ───
  readonly usersPage = signal(1);
  readonly usersPageSize = 5;
  readonly paginatedUsers = computed(() => {
    const list = this.db.users();
    const start = (this.usersPage() - 1) * this.usersPageSize;
    return list.slice(start, start + this.usersPageSize);
  });
  readonly usersTotalPages = computed(() => Math.ceil(this.db.users().length / this.usersPageSize));
  readonly usersPageNumbers = computed(() => {
    const pages: number[] = [];
    const total = this.usersTotalPages();
    const current = this.usersPage();
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  // Collaborators
  newCollabUsername = '';

  readonly currentCollaborators = computed(() => {
    const user = this.db.currentUser();
    if (!user || !user.collaborators) return [];
    return this.db.users().filter(u => user.collaborators!.includes(u.id));
  });

  // Status (Stories)
  newStatusContent = '';
  statusTargetBlogId = '';
  readonly activeStatus = computed(() => {
    const user = this.db.currentUser();
    if (!user) return null;
    const now = Date.now();
    return this.db.blogStatuses()
      .filter(s => s.blogId === user.id && new Date(s.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  });

  constructor(public db: DbService) {
    // Reset pages back to 1 on tab / subtab navigation
    effect(() => {
      this.activeTab();
      this.sysAdminSubTab();
      this.postsPage.set(1);
      this.logsPage.set(1);
      this.usersPage.set(1);
    });

    // Re-initialize forms when the active user changes
    effect(() => {
      const user = this.db.currentUser();
      if (user) {
        this.resetForms();
      }
    });

    // Redirect to login if not authenticated after initial load
    effect(() => {
      if (!this.db.isAuthLoading() && !this.db.isAuthenticated()) {
        this.router.navigate(['/auth']);
      }
    });

    // Verificar e disparar automaticamente newsletters de posts agendados que foram lançados
    effect(() => {
      const articles = this.myArticles();
      if (articles.length === 0) return;

      const now = Date.now();
      const pendingScheduled = articles.filter(art =>
        art.scheduledAt &&
        new Date(art.scheduledAt).getTime() <= now &&
        art.scheduledNewsletter === true &&
        art.newsletterSent !== true
      );

      if (pendingScheduled.length > 0) {
        for (const art of pendingScheduled) {
          this.triggerScheduledNewsletter(art);
        }
      }
    });
  }

  private async uploadImageToS3(file: File, filenamePrefix: string): Promise<string> {
    const filename = `${filenamePrefix}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    const s3 = new S3Client({
      endpoint: 'https://s3.tebi.io',
      region: 'us-east-1',
      credentials: {
        accessKeyId: environment.tebi.accessKeyId,
        secretAccessKey: environment.tebi.secretAccessKey
      }
    });

    const fileBuffer = new Uint8Array(await file.arrayBuffer());

    const cmd = new PutObjectCommand({
      Bucket: 'guiikhub',
      Key: filename,
      Body: fileBuffer,
      ContentType: file.type,
      ACL: 'public-read'
    });

    await s3.send(cmd);
    return uploadUrl;
  }

  resetForms() {
    const user = this.db.currentUser();
    if (!user) return;

    // Profile Settings
    this.profileName = user.displayName;
    this.profileBio = user.bio;
    this.profileAvatar = user.avatarUrl;
    this.profileUsername = user.username;

    // Blog Settings
    const s = user.blogSettings;
    this.blogTitle = s.title;
    this.blogTagline = s.tagline;
    this.blogPrimary = s.primaryColor;
    this.blogAccent = s.accentColor;
    this.blogBg = s.bgColor;
    this.blogCardBg = s.cardBgColor;
    this.blogText = s.textColor;
    this.blogFont = s.fontFamily;
    this.blogLayout = s.layoutType;
    this.blogBannerUrl = s.bannerUrl || '';
    if (this.newPostCoverUrl === '/images/frostbite_cover.png') {
      this.newPostCoverUrl = this.blogBannerUrl || '/images/frostbite_cover.png';
    }
    this.blogSections = s.sections ? [...s.sections] : ['Geral', 'Tech', 'Quadrinhos'];

    this.blogSponsorUrl1 = s.sponsorBannerUrl1 || '';
    this.blogSponsorLink1 = s.sponsorBannerLink1 || '';
    this.blogSponsorUrl2 = s.sponsorBannerUrl2 || '';
    this.blogSponsorLink2 = s.sponsorBannerLink2 || '';
  }

  readonly availableSections = computed(() => {
    const targetId = this.targetBlogId;
    const user = this.db.currentUser();
    if (!targetId || targetId === user?.id) {
      return this.blogSections;
    }
    const blogOwner = this.db.users().find(u => u.id === targetId);
    return blogOwner?.blogSettings?.sections || ['Geral', 'Tech', 'Quadrinhos'];
  });

  readonly targetBlogFollowersCount = computed(() => {
    const targetId = this.targetBlogId || this.db.currentUser()?.id;
    if (!targetId) return 0;
    return this.db.follows().filter(f => f.followedId === targetId).length;
  });

  readonly editingArticle = computed(() => {
    const id = this.editingArticleId();
    if (!id) return null;
    return this.db.articles().find(a => a.id === id) || null;
  });

  readonly filteredLinkArticles = computed(() => {
    const query = this.linkSearchQuery().toLowerCase().trim();
    const currentId = this.editingArticleId();
    const list = this.myArticles().filter(art => art.id !== currentId && (!art.status || art.status === 'published'));
    if (!query) return list;
    return list.filter(art =>
      art.title.toLowerCase().includes(query) ||
      art.summary.toLowerCase().includes(query)
    );
  });

  addSection() {
    const name = this.newSectionName.trim();
    if (!name) return;
    if (this.blogSections.includes(name)) {
      Swal.fire({
        icon: 'error',
        title: 'Seção Duplicada',
        text: 'Esta seção já existe no seu blog.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }
    this.blogSections.push(name);
    this.newSectionName = '';
  }

  removeSection(name: string) {
    this.blogSections = this.blogSections.filter(s => s !== name);
  }

  setTab(tab: 'posts' | 'customize' | 'profile' | 'new-post' | 'collabs' | 'monetization' | 'gamification' | 'spotlight' | 'sys-admin' | 'shop' | 'pods') {
    this.activeTab.set(tab);
    if (tab === 'new-post' && !this.editingArticleId()) {
      // Clear editor when opening the new post tab for a NEW post
      this.clearEditorContent();
      this.newPostTitle = '';
      this.newPostSummary = '';
      this.newPostContent = '';
      this.newPostTags = 'Gamer, Geek, Tech';
      this.newPostSection = '';
      this.newPostIsPaywalled = false;
      this.newPostPaywallPrice = 2;
      this.newPostPaywallPreviewPercentage = 40;
      this.newPostPaywallRequiredBadgeId = '';
      this.targetBlogId = '';
      this.newPostSummary = '';
      this.newPostCoverUrl = this.blogBannerUrl || '/images/frostbite_cover.png';
      this.newPostTags = 'Gamer, Geek, Tech';
      this.newPostSection = '';
      this.targetBlogId = '';
      this.isScheduled = false;
      this.scheduledDateTime = '';
      this.sendNewsletter = false;
    } else if (tab !== 'new-post') {
      this.editingArticleId.set(null);
    }
  }

  // ─── Rich Text Editor Methods ──────────────────────────────────────────────

  onEditorInput(event: Event) {
    const el = event.target as HTMLDivElement;
    this.newPostContent = el.innerHTML;
    this.editorHasContent.set(el.innerText.trim().length > 0);
    this.checkLinkTrigger();
  }

  execFormat(command: string, value?: string) {
    document.execCommand(command, false, value ?? '');
    this.richEditorRef.nativeElement.focus();
    this.syncEditorContent();
  }

  insertHeading(level: 1 | 2 | 3 | 4) {
    document.execCommand('formatBlock', false, `h${level}`);
    this.richEditorRef.nativeElement.focus();
    this.syncEditorContent();
  }

  insertParagraph() {
    document.execCommand('formatBlock', false, 'p');
    this.richEditorRef.nativeElement.focus();
    this.syncEditorContent();
  }

  insertDivider() {
    document.execCommand('insertHTML', false, '<hr><p>&#8203;</p>');
    this.richEditorRef.nativeElement.focus();
    this.syncEditorContent();
  }

  insertLink() {
    const url = prompt('URL do link:');
    if (url) {
      document.execCommand('createLink', false, url);
      this.richEditorRef.nativeElement.focus();
      this.syncEditorContent();
    }
  }

  isUploadingInlineImage = false;

  triggerInlineImageUpload() {
    const input = document.getElementById('inlineImageInput') as HTMLInputElement;
    if (input) {
      input.click();
    }
  }

  async onInlineImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
      return;
    }

    this.isUploadingInlineImage = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'inline');
      document.execCommand('insertImage', false, uploadUrl);
      this.richEditorRef.nativeElement.focus();
      this.syncEditorContent();
    } catch (err) {
      console.error('Erro de rede ao enviar:', err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      this.isUploadingInlineImage = false;
      input.value = ''; // Reset input
    }
  }

  async sendNote() {
    const id = this.editingArticleId();
    if (!id || !this.newNoteContent.trim()) return;
    await this.db.addArticleNote(id, this.newNoteContent);
    this.newNoteContent = '';
  }

  async saveArticleVersionManually() {
    const id = this.editingArticleId();
    if (!id) return;
    const article = this.db.articles().find(a => a.id === id);
    if (!article) return;

    // Create an updated mock article to save current editor state
    const currentArticleState = {
      ...article,
      title: this.newPostTitle,
      summary: this.newPostSummary,
      content: this.newPostContent,
      coverUrl: this.newPostCoverUrl,
      tags: this.newPostTags.split(',').map(t => t.trim()).filter(t => t)
    };

    await this.db.saveArticleVersion(currentArticleState as any);
    Swal.fire({
      icon: 'success',
      title: 'Versão Salva!',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 2000
    });
  }

  restoreVersion(version: any) {
    Swal.fire({
      title: 'Restaurar Versão?',
      text: `Deseja restaurar a versão salva em ${new Date(version.savedAt).toLocaleString()}? Isso irá substituir o conteúdo atual do editor.`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, restaurar',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9'
    }).then((result) => {
      if (result.isConfirmed) {
        this.newPostTitle = version.title;
        this.newPostSummary = version.summary;
        this.newPostContent = version.content;
        this.newPostCoverUrl = version.coverUrl;
        this.newPostTags = (version.tags || []).join(', ');
        this.newPostIsPaywalled = version.isPaywalled ?? false;
        this.newPostPaywallPrice = version.paywallPrice ?? 2;
        this.newPostPaywallPreviewPercentage = version.paywallPreviewPercentage ?? 40;
        this.newPostPaywallRequiredBadgeId = version.paywallRequiredBadgeId ?? '';

        // Update DOM editor
        if (this.richEditorRef?.nativeElement) {
          this.richEditorRef.nativeElement.innerHTML = this.newPostContent;
          this.editorHasContent.set(this.newPostContent.trim().length > 0);
        }

        Swal.fire({
          icon: 'success',
          title: 'Restaurado!',
          toast: true,
          position: 'top-end',
          showConfirmButton: false,
          timer: 2000
        });
      }
    });
  }

  clearEditorContent() {
    if (this.richEditorRef?.nativeElement) {
      this.richEditorRef.nativeElement.innerHTML = '';
      this.newPostContent = '';
      this.editorHasContent.set(false);
    }
  }

  private syncEditorContent() {
    if (this.richEditorRef?.nativeElement) {
      this.newPostContent = this.richEditorRef.nativeElement.innerHTML;
    }
  }

  async saveProfile() {
    if (!this.profileName || !this.profileUsername) {
      Swal.fire({
        icon: 'warning',
        title: 'Campos Vazios',
        text: 'Por favor, preencha o nome e o apelido.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Preencher',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    const result = await this.db.updateProfile(
      this.profileName,
      this.profileBio,
      this.profileAvatar,
      this.profileUsername
    );

    if (result === 'username_taken') {
      Swal.fire({
        icon: 'error',
        title: 'Apelido Indisponível',
        text: 'Este apelido de blog já está sendo usado por outro criador.',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Tentar Outro',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    if (result === 'username_invalid') {
      Swal.fire({
        icon: 'error',
        title: 'Apelido Inválido',
        text: 'O apelido deve conter apenas letras e números (mínimo 1 caractere).',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Corrigir',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    Swal.fire({
      icon: 'success',
      title: 'Perfil Salvo',
      text: 'Seu perfil e o endereço do seu blog foram atualizados com sucesso!',
      timer: 1800,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html'
      }
    });
    this.setTab('posts');
  }

  saveBlogSettings() {
    const settings: BlogSettings = {
      title: this.blogTitle,
      tagline: this.blogTagline,
      primaryColor: this.blogPrimary,
      accentColor: this.blogAccent,
      bgColor: this.blogBg,
      cardBgColor: this.blogCardBg,
      textColor: this.blogText,
      fontFamily: this.blogFont,
      layoutType: this.blogLayout,
      bannerUrl: this.blogBannerUrl || '/images/frostbite_cover.png',
      sponsorBannerUrl1: this.blogSponsorUrl1,
      sponsorBannerLink1: this.blogSponsorLink1,
      sponsorBannerUrl2: this.blogSponsorUrl2,
      sponsorBannerLink2: this.blogSponsorLink2,
      sections: this.blogSections
    };

    this.db.updateBlogSettings(settings);
    Swal.fire({
      icon: 'success',
      title: 'Aparência Salva',
      text: 'As customizações do seu blog foram aplicadas!',
      timer: 1500,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html'
      }
    });
    this.setTab('posts');
  }

  applyPreset(presetType: 'cyberpunk' | 'retro' | 'tabletop' | 'frostbite' | 'rosequartz' | 'aurora') {
    if (presetType === 'frostbite') {
      this.blogPrimary = '#00f0ff';
      this.blogAccent = '#0077ff';
      this.blogBg = '#f0f8ff';
      this.blogCardBg = 'rgba(255, 255, 255, 0.75)';
      this.blogText = '#1e293b';
      this.blogFont = 'Outfit';
      this.blogLayout = 'grid';
      this.blogBannerUrl = '/images/frostbite_cover.png';
    } else if (presetType === 'rosequartz') {
      this.blogPrimary = '#ff4785';
      this.blogAccent = '#ff8cae';
      this.blogBg = '#fff0f5';
      this.blogCardBg = 'rgba(255, 255, 255, 0.75)';
      this.blogText = '#331f26';
      this.blogFont = 'Space Grotesk';
      this.blogLayout = 'magazine';
      this.blogBannerUrl = '/images/rosequartz_cover.png';
    } else if (presetType === 'aurora') {
      this.blogPrimary = '#10b981';
      this.blogAccent = '#34d399';
      this.blogBg = '#f0fdf4';
      this.blogCardBg = 'rgba(255, 255, 255, 0.75)';
      this.blogText = '#064e3b';
      this.blogFont = 'Outfit';
      this.blogLayout = 'list';
      this.blogBannerUrl = '/images/aurora_cover.png';
    }
    // Fallbacks just in case
    else if (presetType === 'cyberpunk') {
      this.blogPrimary = '#00f0ff';
      this.blogAccent = '#ff007f';
      this.blogBg = '#08090d';
      this.blogCardBg = '#121420';
      this.blogText = '#f1f5f9';
      this.blogFont = 'Space Grotesk';
    }
  }

  async savePost(isDraft: boolean = false) {
    // Sync content from editor
    if (this.richEditorRef?.nativeElement) {
      this.newPostContent = this.richEditorRef.nativeElement.innerHTML;
    }

    if (!this.newPostTitle || !this.newPostContent || this.newPostContent === '<br>') {
      Swal.fire({
        icon: 'warning',
        title: 'Campos Vazios',
        text: 'Por favor, preencha o título e o conteúdo da matéria.',
        background: '#121420',
        color: '#f1f5f9',
        buttonsStyling: false
      });
      return;
    }

    if (this.newPostIsPaywalled) {
      // Strip HTML tags for length check
      const textContent = this.newPostContent.replace(/<[^>]*>?/gm, '').trim();
      if (textContent.length < 1500) {
        Swal.fire({
          icon: 'error',
          title: 'Conteúdo Insuficiente',
          text: `Para usar o Terminal Criptografado (Paywall), a matéria precisa ter pelo menos 1.500 caracteres (Atualmente: ${textContent.length}).`,
          background: '#121420',
          color: '#f1f5f9',
          confirmButtonText: 'Entendido'
        });
        return;
      }

      const maxPrice = this.db.currentUserLevel() * 5;
      if (this.newPostPaywallPrice > maxPrice) {
        Swal.fire({
          icon: 'error',
          title: 'Preço Acima do Limite',
          text: `Seu nível atual (${this.db.currentUserLevel()}) permite cobrar no máximo ${maxPrice} Bits.`,
          background: '#121420',
          color: '#f1f5f9',
          confirmButtonText: 'Ajustar'
        });
        return;
      }
    }

    // Validate minimum character length (500 chars excluding whitespace and HTML tags) for publications
    const plainText = this.newPostContent.replace(/<[^>]*>/g, '');
    const cleanText = plainText.replace(/\s/g, '');
    const charCount = cleanText.length;

    if (!isDraft && charCount < 500) {
      Swal.fire({
        icon: 'warning',
        title: 'Matéria Muito Curta',
        html: `O conteúdo da matéria deve ter pelo menos <b>500 caracteres</b> (sem contar espaços) para ser publicado.<br>Seu texto atual possui <b>${charCount} caracteres</b>.`,
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Continuar Escrevendo',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          htmlContainer: 'guiik-swal-html',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    if (!isDraft) {
      const bannedWordsList = this.db.bannedWords();
      if (bannedWordsList && bannedWordsList.length > 0) {
        const normalizeText = (text: string): string => {
          return text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]/g, '');
        };

        const plainContent = this.newPostContent.replace(/<[^>]*>/g, ' ');
        const titleNorm = normalizeText(this.newPostTitle || '');
        const contentNorm = normalizeText(plainContent);
        const summaryNorm = normalizeText(this.newPostSummary || '');
        const tagsNorm = normalizeText(this.newPostTags || '');

        const triggered: string[] = [];

        for (const item of bannedWordsList) {
          const bannedNorm = normalizeText(item.word);
          if (bannedNorm) {
            if (
              titleNorm.includes(bannedNorm) ||
              contentNorm.includes(bannedNorm) ||
              summaryNorm.includes(bannedNorm) ||
              tagsNorm.includes(bannedNorm)
            ) {
              triggered.push(item.word);
            }
          }
        }

        if (triggered.length > 0) {
          Swal.fire({
            icon: 'error',
            title: 'Conteúdo Bloqueado',
            html: `Sua postagem contém termos restritos/sensíveis proibidos pela moderação do sistema:<br><br><span style="color: #ff3333; font-weight: bold; font-size: 1.1rem; border: 1px dashed rgba(255, 50, 50, 0.3); padding: 0.5rem; display: block; border-radius: 6px; background: rgba(255, 50, 50, 0.05);">${triggered.join(', ')}</span><br>Por favor, remova ou edite estes termos para poder publicar a matéria.`,
            background: '#121420',
            color: '#f1f5f9',
            confirmButtonText: 'Revisar Conteúdo',
            customClass: {
              popup: 'guiik-swal-popup',
              title: 'guiik-swal-title',
              htmlContainer: 'guiik-swal-html',
              confirmButton: 'guiik-swal-confirm-btn'
            },
            buttonsStyling: false
          });
          return;
        }
      }
    }

    const tags = this.newPostTags
      .split(',')
      .map(t => t.trim())
      .filter(t => t.length > 0);

    const user = this.db.currentUser();
    if (!user) return;

    const isCollaboratorPost = this.targetBlogId && this.targetBlogId !== user.id;
    let status: 'published' | 'pending' | 'draft' = 'published';
    if (isDraft) {
      status = 'draft';
    } else if (isCollaboratorPost) {
      status = 'pending';
    }

    const scheduledAt = !isDraft && this.isScheduled && this.scheduledDateTime ? new Date(this.scheduledDateTime).toISOString() : null;
    const scheduledNewsletter = !isDraft && this.isScheduled ? this.sendNewsletter : false;

    // Se estiver agendado para o futuro, validamos se a data é realmente no futuro
    if (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) {
      Swal.fire({
        icon: 'warning',
        title: 'Data Inválida',
        text: 'A data de agendamento deve ser no futuro.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    const editId = this.editingArticleId();
    if (editId) {
      await this.db.updateArticle(editId, {
        title: this.newPostTitle,
        summary: this.newPostSummary || this.newPostContent.substring(0, 150) + '...',
        content: this.newPostContent,
        coverUrl: this.newPostCoverUrl,
        tags,
        blogId: this.targetBlogId || user.id,
        status,
        updatedAt: new Date().toISOString(),
        section: this.newPostSection || '',
        scheduledAt: scheduledAt || null,
        scheduledNewsletter,
        isPaywalled: this.newPostIsPaywalled,
        paywallPrice: this.newPostPaywallPrice,
        paywallPreviewPercentage: this.newPostPaywallPreviewPercentage,
        paywallRequiredBadgeId: this.newPostPaywallRequiredBadgeId
      });

      const linkedContractId = this.selectedContractIdForPost();
      if (!isDraft && linkedContractId) {
        await this.db.publishPautaArticle(linkedContractId, editId);
      }

      // Dispara imediatamente se for publicação imediata (não agendada ou agendamento expirado)
      const isPostReleasedNow = !scheduledAt || new Date(scheduledAt).getTime() <= Date.now();
      if (this.sendNewsletter && status === 'published' && isPostReleasedNow && !this.editingArticle()?.newsletterSent) {
        await this.db.sendNewsletter(editId, this.targetBlogId || user.id);
      }

      Swal.fire({
        icon: 'success',
        title: isDraft ? 'Rascunho Atualizado!' : (scheduledAt ? 'Postagem Agendada!' : 'Alterações Publicadas!'),
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } else {
      const createdArticle = await this.db.addArticle(
        this.newPostTitle,
        this.newPostSummary || this.newPostContent.substring(0, 150) + '...',
        this.newPostContent,
        this.newPostCoverUrl,
        tags,
        this.targetBlogId,
        isDraft,
        this.newPostSection || '',
        scheduledAt,
        scheduledNewsletter,
        {
          isPaywalled: this.newPostIsPaywalled,
          paywallPrice: this.newPostPaywallPrice,
          paywallPreviewPercentage: this.newPostPaywallPreviewPercentage,
          paywallRequiredBadgeId: this.newPostPaywallRequiredBadgeId
        }
      );

      // Dispara imediatamente se for publicação imediata
      const isPostReleasedNow = !scheduledAt || new Date(scheduledAt).getTime() <= Date.now();
      if (createdArticle && this.sendNewsletter && !isDraft && isPostReleasedNow) {
        await this.db.sendNewsletter(createdArticle.id, createdArticle.blogId || createdArticle.authorId);
      }

      const linkedContractId = this.selectedContractIdForPost();
      if (createdArticle && !isDraft && linkedContractId) {
        await this.db.publishPautaArticle(linkedContractId, createdArticle.id);
      }

      if (createdArticle && createdArticle.status === 'pending') {
        Swal.fire({
          icon: 'info',
          title: 'Enviada para Aprovação!',
          text: 'A matéria foi salva com sucesso, mas ficará com o status Pendente.',
          timer: 3500,
          showConfirmButton: false,
          background: '#121420',
          color: '#f1f5f9'
        });
      } else {
        const result = await Swal.fire({
          icon: 'success',
          title: scheduledAt ? 'Matéria Agendada!' : 'Matéria Publicada!',
          text: scheduledAt
            ? 'Sua postagem foi agendada e será lançada no horário configurado.'
            : 'Sua matéria foi postada no seu blog e enviada para o feed do GuiikHub!',
          showCancelButton: true,
          confirmButtonText: 'Ver meu Blog',
          cancelButtonText: 'Fechar',
          background: '#121420',
          color: '#f1f5f9',
          customClass: {
            popup: 'guiik-swal-popup',
            title: 'guiik-swal-title',
            htmlContainer: 'guiik-swal-html',
            confirmButton: 'guiik-swal-confirm-btn',
            cancelButton: 'guiik-swal-cancel-btn'
          },
          buttonsStyling: false
        });

        if (result.isConfirmed) {
          const authorUser = this.db.currentUser();
          if (authorUser) {
            this.router.navigate(['/b', authorUser.username]);
          }
        }
      }
    }

    // Clear post form
    this.newPostTitle = '';
    this.newPostSummary = '';
    this.newPostContent = '';
    this.newPostCoverUrl = this.blogBannerUrl || '/images/frostbite_cover.png';
    this.newPostTags = 'Gamer, Geek, Tech';
    this.newPostSection = '';
    this.sendNewsletter = false;
    this.newPostIsPaywalled = false;
    this.newPostPaywallPrice = 2;
    this.newPostPaywallPreviewPercentage = 40;
    this.newPostPaywallRequiredBadgeId = '';
    this.targetBlogId = '';
    this.isScheduled = false;
    this.scheduledDateTime = '';
    this.selectedContractIdForPost.set(null);
    this.clearEditorContent();
    this.editingArticleId.set(null);

    this.setTab('posts');
  }

  editPost(art: any) {
    this.editingArticleId.set(art.id);
    this.newPostTitle = art.title;
    this.newPostSummary = art.summary;
    this.newPostContent = art.content;
    this.newPostCoverUrl = art.coverUrl;
    this.newPostTags = art.tags.join(', ');
    this.newPostSection = art.section || '';
    this.newPostIsPaywalled = art.isPaywalled || false;
    this.newPostPaywallPrice = art.paywallPrice || 2;
    this.newPostPaywallPreviewPercentage = art.paywallPreviewPercentage || 40;
    this.newPostPaywallRequiredBadgeId = art.paywallRequiredBadgeId || '';
    this.targetBlogId = art.blogId !== art.authorId ? art.blogId : '';

    if (art.scheduledAt) {
      this.isScheduled = new Date(art.scheduledAt).getTime() > Date.now();
      const date = new Date(art.scheduledAt);
      const tzOffset = date.getTimezoneOffset() * 60000;
      const localISOTime = (new Date(date.getTime() - tzOffset)).toISOString().slice(0, 16);
      this.scheduledDateTime = localISOTime;
    } else {
      this.isScheduled = false;
      this.scheduledDateTime = '';
    }

    this.sendNewsletter = art.scheduledNewsletter || art.newsletterSent || false;

    this.setTab('new-post');

    // Set editor content
    setTimeout(() => {
      if (this.richEditorRef?.nativeElement) {
        this.richEditorRef.nativeElement.innerHTML = this.newPostContent;
        this.editorHasContent.set(this.newPostContent.trim().length > 0);
      }
    }, 100);
  }

  isFutureDate(dateStr?: string): boolean {
    if (!dateStr) return false;
    return new Date(dateStr).getTime() > Date.now();
  }

  async triggerScheduledNewsletter(art: any) {
    // Evitar disparos repetidos marcando localmente
    art.newsletterSent = true;

    Swal.fire({
      title: 'Disparando Newsletter Agendada',
      text: `O post agendado "${art.title}" já está público. Enviando newsletter aos seguidores...`,
      icon: 'info',
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 4500,
      background: '#121420',
      color: '#f1f5f9'
    });

    await this.db.sendNewsletter(art.id, art.blogId || art.authorId);
  }

  @HostListener('document:click', ['$event'])
  onClickOutside(event: MouseEvent) {
    if (this.showLinkSelector) {
      const target = event.target as HTMLElement;
      const clickedInsideEditor = this.richEditorRef?.nativeElement?.contains(target);
      const clickedInsideDropdown = target.closest('.internal-link-dropdown');
      if (!clickedInsideEditor && !clickedInsideDropdown) {
        this.showLinkSelector = false;
      }
    }
  }

  checkLinkTrigger() {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      this.showLinkSelector = false;
      return;
    }

    const editorEl = this.richEditorRef.nativeElement;
    const cursorRange = selection.getRangeAt(0);

    // Garantir que a seleção está dentro do editor
    if (!editorEl.contains(cursorRange.commonAncestorContainer)) {
      this.showLinkSelector = false;
      return;
    }

    try {
      // Obter o bloco/parágrafo atual para escanear localmente
      const preCaretRange = cursorRange.cloneRange();
      let blockNode = cursorRange.startContainer;
      while (blockNode && blockNode.parentNode && blockNode.parentNode !== editorEl) {
        blockNode = blockNode.parentNode;
      }
      preCaretRange.setStart(blockNode, 0);

      const textBeforeCursor = preCaretRange.toString();
      const index = textBeforeCursor.lastIndexOf('[[');

      if (index !== -1) {
        const queryText = textBeforeCursor.substring(index + 2);
        // O gatilho fecha se houver um fecho ']]' no meio ou quebra de linha
        if (!queryText.includes(']]') && !queryText.includes('\n')) {
          this.showLinkSelector = true;
          const prevQuery = this.linkSearchQuery();
          this.linkSearchQuery.set(queryText);
          if (prevQuery !== queryText) {
            this.linkSelectorSelectedIndex.set(0);
          }

          // Obter coordenadas absolutas em relação à página (scrollY + scrollX)
          const clonedRange = cursorRange.cloneRange();
          const textNode = cursorRange.startContainer;
          const cursorOffset = cursorRange.startOffset;
          const scrollY = window.scrollY || window.pageYOffset;
          const scrollX = window.scrollX || window.pageXOffset;

          if (textNode.nodeType === Node.TEXT_NODE && cursorOffset > 0) {
            clonedRange.setStart(textNode, cursorOffset - 1);
            clonedRange.setEnd(textNode, cursorOffset);
            const rect = clonedRange.getBoundingClientRect();
            if (rect.top !== 0 || rect.left !== 0) {
              this.linkSelectorPosition = {
                top: rect.bottom + scrollY + 5,
                left: rect.right + scrollX
              };
            } else {
              const editorRect = editorEl.getBoundingClientRect();
              this.linkSelectorPosition = {
                top: editorRect.top + scrollY + 40,
                left: editorRect.left + scrollX + 20
              };
            }
          } else {
            const rect = cursorRange.getBoundingClientRect();
            if (rect.left !== 0 || rect.top !== 0) {
              this.linkSelectorPosition = {
                top: rect.bottom + scrollY + 5,
                left: rect.left + scrollX
              };
            } else {
              const editorRect = editorEl.getBoundingClientRect();
              this.linkSelectorPosition = {
                top: editorRect.top + scrollY + 40,
                left: editorRect.left + scrollX + 20
              };
            }
          }
          return;
        }
      }
    } catch (err) {
      console.error('Erro ao calcular gatilho de linkagem:', err);
    }

    this.showLinkSelector = false;
  }

  onEditorKeydown(event: KeyboardEvent) {
    if (this.showLinkSelector) {
      const articles = this.filteredLinkArticles();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.linkSelectorSelectedIndex.update(idx => (idx + 1) % (articles.length || 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.linkSelectorSelectedIndex.update(idx => (idx - 1 + articles.length) % (articles.length || 1));
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (articles.length > 0) {
          this.insertInternalLink(articles[this.linkSelectorSelectedIndex()]);
        } else {
          this.showLinkSelector = false;
        }
      } else if (event.key === 'Escape') {
        event.preventDefault();
        this.showLinkSelector = false;
      }
    }
  }

  insertInternalLink(art: any) {
    if (typeof window === 'undefined') return;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);

    const textNode = range.startContainer;
    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const textContent = textNode.textContent || '';
    const cursorOffset = range.startOffset;
    const textBeforeCursor = textContent.substring(0, cursorOffset);

    const index = textBeforeCursor.lastIndexOf('[[');
    if (index !== -1) {
      // Definir a seleção do início do [[ até o cursor
      range.setStart(textNode, index);
      range.setEnd(textNode, cursorOffset);
      range.deleteContents();

      // Criar nó do link
      const link = document.createElement('a');
      link.href = `/b/${art.authorUsername}/post/${art.slug}`;
      link.className = 'internal-link';
      link.innerText = art.title;
      // Estilos customizados elegantes cyberpunk
      link.style.color = '#00f0ff';
      link.style.textDecoration = 'underline';
      link.style.fontWeight = 'bold';

      range.insertNode(link);

      // Inserir espaço pós link
      const space = document.createTextNode('\u00A0');
      range.collapse(false);
      range.insertNode(space);

      // Colocar o cursor depois do espaço
      const newRange = document.createRange();
      newRange.setStartAfter(space);
      newRange.setEndAfter(space);
      selection.removeAllRanges();
      selection.addRange(newRange);

      this.syncEditorContent();
    }

    this.showLinkSelector = false;
    this.linkSearchQuery.set('');
    this.richEditorRef.nativeElement.focus();
  }

  async onCoverFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    // File size validation (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
      return;
    }

    this.isUploadingCover = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'cover');
      this.newPostCoverUrl = uploadUrl;
      Swal.fire({
        icon: 'success',
        title: 'Imagem Enviada!',
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } catch (err) {
      console.error('Erro de rede ao enviar:', err);
      Swal.fire('Erro de Rede', 'Não foi possível conectar ao provedor de armazenamento.', 'error');
    } finally {
      this.isUploadingCover = false;
    }
  }

  deletePost(id: string) {
    Swal.fire({
      title: 'Excluir Matéria?',
      text: 'Essa ação é definitiva e removerá a matéria e seus comentários do banco!',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Excluir',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-cancel-btn'
      },
      buttonsStyling: false
    }).then((result) => {
      if (result.isConfirmed) {
        this.db.deleteArticle(id);
        Swal.fire({
          icon: 'success',
          title: 'Excluído!',
          text: 'A matéria foi deletada com sucesso.',
          timer: 1200,
          showConfirmButton: false,
          background: '#121420',
          color: '#f1f5f9',
          customClass: {
            popup: 'guiik-swal-popup',
            title: 'guiik-swal-title',
            htmlContainer: 'guiik-swal-html'
          }
        });
      }
    });
  }

  approvePost(id: string) {
    this.db.approveArticle(id);
    Swal.fire({
      icon: 'success',
      title: 'Aprovada!',
      text: 'A matéria foi aprovada e agora está pública no seu blog.',
      timer: 1500,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        htmlContainer: 'guiik-swal-html'
      }
    });
  }

  async onBlogBannerSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
      return;
    }

    this.isUploadingBlogBanner = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'banner');
      this.blogBannerUrl = uploadUrl;
      Swal.fire({
        icon: 'success',
        title: 'Capa do Blog Enviada!',
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } catch (err) {
      console.error('Erro ao enviar capa do blog:', err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      this.isUploadingBlogBanner = false;
      input.value = '';
    }
  }

  async onSponsorBannerSelected(event: Event, sponsorIndex: 1 | 2) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 2 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'O banner deve ter no máximo 2MB.', 'error');
      return;
    }

    if (sponsorIndex === 1) this.isUploadingSponsor1 = true;
    else this.isUploadingSponsor2 = true;

    try {
      const uploadUrl = await this.uploadImageToS3(file, `sponsor${sponsorIndex}`);
      if (sponsorIndex === 1) this.blogSponsorUrl1 = uploadUrl;
      else this.blogSponsorUrl2 = uploadUrl;

      Swal.fire({
        icon: 'success',
        title: 'Banner Enviado!',
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } catch (err) {
      console.error(`Erro ao enviar banner sponsor ${sponsorIndex}:`, err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      if (sponsorIndex === 1) this.isUploadingSponsor1 = false;
      else this.isUploadingSponsor2 = false;
      input.value = '';
    }
  }

  async onAvatarSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
      return;
    }

    this.isUploadingAvatar = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'avatar');
      this.profileAvatar = uploadUrl;
      Swal.fire({
        icon: 'success',
        title: 'Avatar Enviado!',
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } catch (err) {
      console.error('Erro ao enviar avatar:', err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      this.isUploadingAvatar = false;
      input.value = '';
    }
  }

  async addCollaborator() {
    if (!this.newCollabUsername) return;
    const res = await this.db.addCollaborator(this.newCollabUsername);
    if (res === true) {
      Swal.fire({ icon: 'success', title: 'Adicionado!', text: 'Colaborador adicionado.', background: '#121420', color: '#f1f5f9' });
      this.newCollabUsername = '';
    } else if (res === 'not_found') {
      Swal.fire({ icon: 'error', title: 'Erro', text: 'Usuário não encontrado.', background: '#121420', color: '#f1f5f9' });
    } else if (res === 'already_added') {
      Swal.fire({ icon: 'error', title: 'Erro', text: 'Este usuário já é seu colaborador.', background: '#121420', color: '#f1f5f9' });
    } else if (res === 'self') {
      Swal.fire({ icon: 'error', title: 'Erro', text: 'Você não pode adicionar a si mesmo.', background: '#121420', color: '#f1f5f9' });
    }
  }

  async removeCollaborator(id: string) {
    if (confirm('Tem certeza que deseja remover este colaborador?')) {
      await this.db.removeCollaborator(id);
    }
  }

  // Status (Stories)
  async postStatus() {
    if (!this.newStatusContent.trim()) return;
    if (this.newStatusContent.length > 150) {
      Swal.fire({
        icon: 'error',
        title: 'Texto muito longo',
        text: 'O status deve ter no máximo 150 caracteres.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    await this.db.addBlogStatus(this.newStatusContent, this.statusTargetBlogId || undefined);
    this.newStatusContent = '';

    Swal.fire({
      icon: 'success',
      title: 'Status Publicado!',
      text: 'Seu status ficará visível por 24 horas.',
      timer: 1500,
      showConfirmButton: false,
      background: '#121420',
      color: '#f1f5f9'
    });
  }

  async deleteStatus(id: string) {
    await this.db.deleteBlogStatus(id);
  }

  async urlToBase64(url: string | undefined): Promise<string> {
    if (!url) return '';
    if (url.startsWith('data:')) return url;

    let targetUrl = url;
    if (url.startsWith('/')) {
      targetUrl = window.location.origin + url;
    }

    // Usar uma série de proxies hiper confiáveis em cascata para garantir o Base64
    const proxies = [
      targetUrl, // Tenta direto primeiro
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
      `https://wsrv.nl/?url=${encodeURIComponent(targetUrl)}&output=webp`,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`
    ];

    for (const proxy of proxies) {
      try {
        const response = await fetch(proxy, { mode: 'cors' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) continue;

        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (e) {
        continue;
      }
    }

    return url; // Se tudo falhar (improvável), retorna a original
  }

  async generateSocialImage(article: any) {
    if (typeof window === 'undefined') return;

    const formatChoice = await Swal.fire({
      title: 'Qual formato?',
      text: 'Escolha o formato ideal para a sua imagem.',
      showDenyButton: true,
      showCancelButton: true,
      confirmButtonText: '📱 Story (1080x1920)',
      denyButtonText: '🖼️ Feed (1080x1080)',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        denyButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-cancel-btn'
      },
      buttonsStyling: false
    });

    if (!formatChoice.isConfirmed && !formatChoice.isDenied) {
      return; // Canceled
    }

    const isFeed = formatChoice.isDenied;

    Swal.fire({ title: 'Preparando Arte...', text: 'Baixando imagens diretamente na memória...', showConfirmButton: false, allowOutsideClick: false, background: '#121420', color: '#f1f5f9' });
    Swal.showLoading();

    // Buscar Base64 absoluto de forma blindada
    const coverBase64 = await this.urlToBase64(article.coverUrl);
    const authorAvatarBase64 = await this.urlToBase64(article.authorAvatarUrl);

    const currentUser = this.db.currentUser();
    const blogAvatarBase64 = await this.urlToBase64(currentUser?.avatarUrl);

    // Set article so angular renders the text
    this.storyPreviewArticle.set({
      ...article,
      _blogName: currentUser?.blogSettings?.title || currentUser?.displayName
    });

    // Give Angular a tick to render the off-screen template text
    setTimeout(async () => {
      const templateId = isFeed ? 'feed-template' : 'story-template';
      const element = document.getElementById(templateId);
      if (!element) return;

      try {
        Swal.update({ title: 'Injetando pixels...' });

        // Injeção manual no DOM para burlar sanitizadores do Angular e falhas do html2canvas
        const prefix = isFeed ? 'feed' : 'story';
        const bgLayer = element.querySelector(`#${prefix}-bg-layer`) as HTMLElement;
        const blogAvatarLayer = element.querySelector(`#${prefix}-blog-avatar-layer`) as HTMLImageElement;
        const authorAvatarLayer = element.querySelector(`#${prefix}-author-avatar-layer`) as HTMLImageElement;

        if (bgLayer) bgLayer.style.backgroundImage = `url(${coverBase64})`;
        if (blogAvatarLayer) blogAvatarLayer.src = blogAvatarBase64;
        if (authorAvatarLayer) authorAvatarLayer.src = authorAvatarBase64;

        // Espera explícita para garantir que as tags img injetadas concluíram o carregamento do base64
        const images = Array.from(element.querySelectorAll('img'));
        await Promise.all(images.map(img => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve; // Continue even se quebrar
          });
        }));

        Swal.update({ title: 'Tirando a foto final...' });

        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(element, {
          scale: 2, // High resolution
          useCORS: true,
          backgroundColor: '#0d0e15',
          logging: false
        });

        const link = document.createElement('a');
        link.download = `${prefix}-${article.slug || 'post'}.png`;
        link.href = canvas.toDataURL('image/png', 0.95);
        link.click();

        this.storyPreviewArticle.set(null);
        Swal.close();

        Swal.fire({
          icon: 'success',
          title: 'Arte Pronta!',
          text: 'Imagem gerada com imagens completas!',
          timer: 2000,
          showConfirmButton: false,
          background: '#121420',
          color: '#f1f5f9'
        });
      } catch (err) {
        console.error(err);
        Swal.fire({ icon: 'error', title: 'Erro', text: 'Não foi possível gerar a arte.', background: '#121420', color: '#f1f5f9' });
        this.storyPreviewArticle.set(null);
      }
    }, 300);
  }

  ngOnInit() {
    this.startCountdownTimer();

    // Check for active tab in query parameters
    this.route.queryParams.subscribe(params => {
      const tab = params['tab'];
      if (tab && ['posts', 'customize', 'profile', 'new-post', 'collabs', 'monetization', 'gamification', 'spotlight', 'sys-admin'].includes(tab)) {
        this.setTab(tab as any);
      }
    });
  }

  ngOnDestroy() {
    if (this.timerIntervalId) {
      clearInterval(this.timerIntervalId);
    }
  }

  private startCountdownTimer() {
    if (typeof window === 'undefined') return;

    const updateTimer = () => {
      const now = new Date();
      const midnight = new Date();
      midnight.setHours(24, 0, 0, 0);

      const diffMs = midnight.getTime() - now.getTime();
      if (diffMs <= 0) {
        this.timeLeftString = '00:00:00';
        return;
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

      const pad = (n: number) => n.toString().padStart(2, '0');
      this.timeLeftString = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
    };

    updateTimer();
    this.timerIntervalId = setInterval(updateTimer, 1000);
  }

  async placeSpotlightBid() {
    if (this.db.leilaoDiaAtual()?.finalizado) {
      Swal.fire({
        icon: 'error',
        title: 'Leilão Encerrado',
        text: 'Não é possível enviar lances para um leilão já finalizado!',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    if (!this.selectedArticleForSpotlightId) {
      Swal.fire({
        icon: 'warning',
        title: 'Selecione uma Matéria',
        text: 'Você precisa escolher uma matéria para receber o Holofote!',
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'OK',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    const currentHighest = this.db.leilaoDiaAtual()?.maiorLanceAtual || 0;
    const minRequired = currentHighest === 0 ? 10 : currentHighest + 10;

    if (this.spotlightBidAmount < minRequired) {
      Swal.fire({
        icon: 'warning',
        title: 'Lance Inválido',
        text: `O lance mínimo exigido é de ${minRequired} Bits!`,
        background: '#121420',
        color: '#f1f5f9',
        confirmButtonText: 'Entendido',
        customClass: {
          popup: 'guiik-swal-popup',
          title: 'guiik-swal-title',
          confirmButton: 'guiik-swal-confirm-btn'
        },
        buttonsStyling: false
      });
      return;
    }

    const success = await this.db.placeBid(this.selectedArticleForSpotlightId, this.spotlightBidAmount);
    if (success) {
      this.spotlightBidAmount = this.spotlightBidAmount + 10;
    }
  }

  async grantBits() {
    if (!this.sysAdminGrantUserId) {
      Swal.fire('Erro', 'Selecione um usuário para ajustar o saldo.', 'error');
      return;
    }
    const success = await this.db.grantBitsToUser(
      this.sysAdminGrantUserId,
      this.sysAdminGrantAmount,
      this.sysAdminGrantDescription
    );
    if (success) {
      Swal.fire({
        icon: 'success',
        title: 'Saldo Ajustado!',
        text: `O saldo do usuário foi alterado com sucesso em ${this.sysAdminGrantAmount} Bits.`,
        background: '#121420',
        color: '#f1f5f9'
      });
      this.sysAdminGrantAmount = 10;
      this.sysAdminGrantDescription = 'Bonificação administrativa';
    }
  }

  async changeUserRole(userId: string, newRole: 'admin' | 'creator') {
    const success = await this.db.updateUserRole(userId, newRole);
    if (success) {
      Swal.fire({
        icon: 'success',
        title: 'Cargo Atualizado!',
        text: `O cargo do usuário foi atualizado para ${newRole === 'admin' ? 'Administrador' : 'Criador'}.`,
        background: '#121420',
        color: '#f1f5f9'
      });
    } else {
      Swal.fire('Erro', 'Não foi possível atualizar o cargo.', 'error');
    }
  }

  async triggerManualConsolidation() {
    const active = this.db.holofoteAtivo();
    if (!active) {
      Swal.fire('Erro', 'Configuração de holofote não disponível.', 'error');
      return;
    }

    Swal.fire({
      title: 'Consolidar Leilão?',
      text: `Esta ação fechará o leilão da data ${active.dataDestaque} e atualizará o holofote do feed. Deseja continuar?`,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Sim, Consolidar',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    }).then(async (result) => {
      if (result.isConfirmed) {
        Swal.fire({
          title: 'Processando Consolidação...',
          allowOutsideClick: false,
          background: '#121420',
          color: '#f1f5f9',
          didOpen: () => {
            Swal.showLoading();
          }
        });
        const dateToClose = active.dataDestaque;
        const success = await this.db.consolidarLeilaoDia(dateToClose);
        Swal.close();
        if (success) {
          Swal.fire({
            icon: 'success',
            title: 'Leilão Consolidado!',
            text: `O leilão da data ${dateToClose} foi consolidado. O topo do feed foi atualizado.`,
            background: '#121420',
            color: '#f1f5f9'
          });
        }
      }
    });
  }

  async triggerManualMigration() {
    Swal.fire({
      title: 'Executar Migração?',
      text: 'Todos os usuários ausentes de Bits/XP serão inicializados com 0.',
      icon: 'info',
      showCancelButton: true,
      confirmButtonText: 'Sim, Executar',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    }).then(async (result) => {
      if (result.isConfirmed) {
        await this.db.runGamificationMigration();
        Swal.fire({
          icon: 'success',
          title: 'Migração Concluída!',
          text: 'Os dados foram migrados com sucesso.',
          background: '#121420',
          color: '#f1f5f9'
        });
      }
    });
  }

  async addBannedWord() {
    const wordClean = this.newBannedWord.trim();
    if (!wordClean) {
      Swal.fire({
        icon: 'warning',
        title: 'Entrada Inválida',
        text: 'A palavra proibida não pode estar vazia.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    const exists = this.db.bannedWords().some(
      item => item.word.toLowerCase() === wordClean.toLowerCase()
    );
    if (exists) {
      Swal.fire({
        icon: 'warning',
        title: 'Palavra Duplicada',
        text: 'Esta palavra já existe na lista negra.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    this.isSavingBannedWord = true;
    try {
      await this.db.addBannedWord(wordClean);
      Swal.fire({
        icon: 'success',
        title: 'Palavra Adicionada!',
        text: `"${wordClean}" foi registrada na lista negra de moderação.`,
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
      this.newBannedWord = '';
    } catch (err) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: 'Não foi possível salvar a palavra proibida.',
        background: '#121420',
        color: '#f1f5f9'
      });
    } finally {
      this.isSavingBannedWord = false;
    }
  }

  async deleteBannedWord(id: string) {
    const item = this.db.bannedWords().find(w => w.id === id);
    if (!item) return;

    Swal.fire({
      title: 'Excluir da Lista Negra?',
      text: `Deseja realmente permitir novamente a palavra "${item.word}" nas postagens?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Excluir',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          await this.db.deleteBannedWord(id);
          Swal.fire({
            icon: 'success',
            title: 'Palavra Excluída!',
            text: `A palavra "${item.word}" foi removida da lista negra com sucesso.`,
            background: '#121420',
            color: '#f1f5f9'
          });
        } catch (err) {
          console.error(err);
          Swal.fire('Erro', 'Não foi possível excluir a palavra.', 'error');
        }
      }
    });
  }

  async createContract() {
    const title = this.newContractTitle.trim();
    const description = this.newContractDescription.trim();
    const goal = this.newContractGoal;

    if (!title || !description || goal <= 0) {
      Swal.fire({
        icon: 'warning',
        title: 'Dados Incompletos',
        text: 'Por favor, preencha todos os campos do contrato.',
        background: '#121420',
        color: '#f1f5f9'
      });
      return;
    }

    this.isSavingContract = true;
    try {
      await this.db.createPautaContract(title, description, goal);
      Swal.fire({
        icon: 'success',
        title: 'Pauta Aberta!',
        text: `O contrato "${title}" foi aberto para financiamento coletivo com sucesso.`,
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
      this.newContractTitle = '';
      this.newContractDescription = '';
      this.newContractGoal = 100;
    } catch (err: any) {
      console.error(err);
      Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: err.message || 'Não foi possível criar o contrato de pauta.',
        background: '#121420',
        color: '#f1f5f9'
      });
    } finally {
      this.isSavingContract = false;
    }
  }

  getContractById(id: string): PautaContract | null {
    return this.db.pautaContracts().find(c => c.id === id) || null;
  }

  getArticleTitle(id: string): string {
    return this.db.articles().find(a => a.id === id)?.title || 'Matéria do Criador';
  }

  async onBadgeIconSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 2 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem do emblema deve ter no máximo 2MB.', 'error');
      return;
    }

    this.isUploadingBadgeIcon = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'badge');
      this.badgeIconUrl = uploadUrl;
      Swal.fire({
        icon: 'success',
        title: 'Ícone Enviado!',
        timer: 1500,
        showConfirmButton: false,
        background: '#121420',
        color: '#f1f5f9'
      });
    } catch (err) {
      console.error('Erro ao enviar ícone de badge:', err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      this.isUploadingBadgeIcon = false;
      input.value = '';
    }
  }

  async saveBadge() {
    if (!this.badgeName || !this.badgeDescription) {
      Swal.fire('Campos inválidos', 'Preencha o nome e a descrição do emblema.', 'warning');
      return;
    }
    if (this.badgeType === 'xp' && this.badgeXpRequirement <= 0) {
      Swal.fire('Campos inválidos', 'Preencha um marco de XP válido.', 'warning');
      return;
    }
    if (this.badgeType === 'event' && !this.badgeTargetDate) {
      Swal.fire('Campos inválidos', 'Por favor, selecione uma data válida para o evento.', 'warning');
      return;
    }

    const xpReq = this.badgeType === 'xp' ? this.badgeXpRequirement : 0;
    const targetDate = this.badgeType === 'event' ? this.badgeTargetDate : '';

    const success = await this.db.createBadge(
      this.badgeName,
      this.badgeDescription,
      xpReq,
      this.badgeIconUrl,
      this.badgeType,
      targetDate,
      this.badgeRewardBits
    );
    if (success) {
      this.badgeName = '';
      this.badgeDescription = '';
      this.badgeXpRequirement = 100;
      this.badgeType = 'xp';
      this.badgeTargetDate = '';
      this.badgeIconUrl = '';
      this.badgeRewardBits = 0;
    }
  }

  async deleteBadge(id: string) {
    Swal.fire({
      title: 'Excluir Emblema?',
      text: 'Tem certeza que deseja apagar este emblema? Isso removerá o emblema do sistema.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Apagar',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    }).then(async (result) => {
      if (result.isConfirmed) {
        await this.db.deleteBadge(id);
      }
    });
  }

  getUserBadges(user: any): any[] {
    if (!user || !user.unlockedBadges) return [];
    return this.db.badges().filter(b => user.unlockedBadges.includes(b.id));
  }

  async assignBadgeToUser(userId: string, badgeId: string) {
    if (!userId || !badgeId) return;

    Swal.fire({
      title: 'Atribuindo Emblema...',
      allowOutsideClick: false,
      background: '#121420',
      color: '#f1f5f9',
      didOpen: () => {
        Swal.showLoading();
      }
    });

    const success = await this.db.assignBadgeToUser(userId, badgeId);
    Swal.close();

    if (success) {
      Swal.fire({
        icon: 'success',
        title: 'Emblema Atribuído!',
        text: 'O emblema foi associado ao usuário com sucesso.',
        background: '#121420',
        color: '#f1f5f9',
        timer: 2000,
        showConfirmButton: false
      });
    } else {
      Swal.fire('Erro', 'Não foi possível atribuir o emblema.', 'error');
    }
  }

  async removeBadgeFromUser(userId: string, badgeId: string) {
    if (!userId || !badgeId) return;

    const result = await Swal.fire({
      title: 'Remover Emblema?',
      text: 'Tem certeza que deseja revogar este emblema deste usuário?',
      icon: 'warning',
      showCancelButton: true,
      background: '#121420',
      color: '#f1f5f9',
      confirmButtonColor: '#ef4444',
      cancelButtonColor: '#374151',
      confirmButtonText: 'Sim, remover',
      cancelButtonText: 'Cancelar'
    });

    if (result.isConfirmed) {
      Swal.fire({
        title: 'Removendo Emblema...',
        allowOutsideClick: false,
        background: '#121420',
        color: '#f1f5f9',
        didOpen: () => {
          Swal.showLoading();
        }
      });

      const success = await this.db.removeBadgeFromUser(userId, badgeId);
      Swal.close();

      if (success) {
        Swal.fire({
          icon: 'success',
          title: 'Emblema Removido!',
          text: 'O emblema foi revogado com sucesso.',
          background: '#121420',
          color: '#f1f5f9',
          timer: 2000,
          showConfirmButton: false
        });
      } else {
        Swal.fire('Erro', 'Não foi possível remover o emblema.', 'error');
      }
    }
  }

  // --- CYBER-SHOP ACTIONS ---

  async saveShopItem() {
    let finalValue = this.newItemValue;

    if (this.useCustomStyling) {
      if (this.newItemCategory === 'frame') {
        finalValue = JSON.stringify({
          isCustom: true,
          color1: this.frameColor1,
          color2: this.frameColor2,
          glowColor: this.frameGlowColor,
          shape: this.frameShape,
          animation: this.frameAnimation
        });
      } else if (this.newItemCategory === 'theme') {
        finalValue = JSON.stringify({
          isCustom: true,
          primaryColor: this.themePrimaryColor,
          bgColor: this.themeBgColor,
          cardBgColor: this.themeCardBgColor,
          textColor: this.themeTextColor,
          accentColor: this.themeAccentColor,
          effect: this.themeEffect
        });
      }
    }

    if (!this.newItemName || !this.newItemDescription || (!finalValue && !this.useCustomStyling) || this.newItemCost <= 0) {
      Swal.fire('Campos inválidos', 'Preencha o nome, descrição, valor/personalização e custo do item.', 'warning');
      return;
    }
    this.isCreatingShopItem = true;
    const success = await this.db.createShopItem(
      this.newItemName,
      this.newItemDescription,
      this.newItemCost,
      this.newItemCategory,
      finalValue,
      this.newItemImageUrl
    );
    this.isCreatingShopItem = false;
    if (success) {
      this.newItemName = '';
      this.newItemDescription = '';
      this.newItemCost = 100;
      this.newItemCategory = 'frame';
      this.newItemValue = '';
      this.newItemImageUrl = '';
      this.useCustomStyling = false;
    }
  }

  async deleteShopItem(itemId: string) {
    Swal.fire({
      title: 'Excluir Item da Loja?',
      text: 'Tem certeza que deseja remover este item cosmético da Cyber-Shop?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim, Remover',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9',
      customClass: {
        popup: 'guiik-swal-popup',
        title: 'guiik-swal-title',
        confirmButton: 'guiik-swal-confirm-btn',
        cancelButton: 'guiik-swal-confirm-btn'
      },
      buttonsStyling: false
    }).then(async (result) => {
      if (result.isConfirmed) {
        await this.db.deleteShopItem(itemId);
      }
    });
  }

  async buyItem(itemId: string) {
    const user = this.db.currentUser();
    if (!user) {
      Swal.fire('Aviso', 'Você precisa estar logado para comprar itens.', 'warning');
      return;
    }
    await this.db.buyShopItem(user.id, itemId);
  }

  isPurchased(itemId: string): boolean {
    const user = this.db.currentUser();
    if (!user) return false;
    return user.purchasedItems?.includes(itemId) || false;
  }

  async equipCosmetic(category: 'frame' | 'tag' | 'theme', itemValue: string) {
    const user = this.db.currentUser();
    if (!user) return;
    await this.db.updateActiveCosmetic(user.id, category, itemValue);
  }

  async selectFeaturedBadge(badgeId: string) {
    await this.db.selectFeaturedBadge(badgeId);
  }

  isEquipped(category: 'frame' | 'tag' | 'theme', itemValue: string): boolean {
    const user = this.db.currentUser();
    if (!user) return false;
    if (category === 'frame') return user.activeFrame === itemValue;
    if (category === 'tag') return user.activeTag === itemValue;
    if (category === 'theme') return user.activeTheme === itemValue;
    return false;
  }

  getFilteredShopItems(category: 'frame' | 'tag' | 'theme' | 'other'): ShopItem[] {
    return this.db.shopItems().filter(item => item.category === category);
  }

  getPurchasedThemes(): ShopItem[] {
    const user = this.db.currentUser();
    if (!user) return [];
    return this.db.shopItems().filter(item =>
      item.category === 'theme' && user.purchasedItems?.includes(item.id)
    );
  }

  getPurchasedFrames(): ShopItem[] {
    const user = this.db.currentUser();
    if (!user) return [];
    return this.db.shopItems().filter(item =>
      item.category === 'frame' && user.purchasedItems?.includes(item.id)
    );
  }

  getPurchasedTags(): ShopItem[] {
    const user = this.db.currentUser();
    if (!user) return [];
    return this.db.shopItems().filter(item =>
      item.category === 'tag' && user.purchasedItems?.includes(item.id)
    );
  }

  // --- REPORT MANAGEMENT ---
  async resolveReport(reportId: string, action: 'dismiss' | 'refund') {
    const actionText = action === 'dismiss' ? 'Descartar Denúncia' : 'Estornar Bits e Penalizar';
    const confirm = await Swal.fire({
      title: actionText,
      text: 'Tem certeza que deseja aplicar esta resolução?',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9'
    });

    if (confirm.isConfirmed) {
      const success = await this.db.resolveReport(reportId, action);
      if (success) {
        Swal.fire('Sucesso', 'Ação aplicada.', 'success');
      } else {
        Swal.fire('Erro', 'Falha ao processar.', 'error');
      }
    }
  }

  // --- DATA PODS MANAGEMENT ---
  async onPodCoverSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;
    const file = input.files[0];

    if (file.size > 5 * 1024 * 1024) {
      Swal.fire('Arquivo muito grande', 'A imagem deve ter no máximo 5MB.', 'error');
      return;
    }

    this.isUploadingPodCover = true;
    try {
      const uploadUrl = await this.uploadImageToS3(file, 'pod-cover');
      this.newPodCoverUrl = uploadUrl;
    } catch (err) {
      console.error('Erro ao enviar capa da cápsula:', err);
      Swal.fire('Erro de Rede', 'Não foi possível enviar a imagem.', 'error');
    } finally {
      this.isUploadingPodCover = false;
      input.value = '';
    }
  }

  async createDataPod() {
    if (!this.newPodTitle || !this.newPodDescription) {
      Swal.fire('Preencha tudo', 'Dê um nome e descrição para a Cápsula.', 'warning');
      return;
    }
    const user = this.db.currentUser();
    if (!user) return;

    const podId = 'pod_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    
    try {
      await this.db.createDataPod({
        id: podId,
        ownerId: user.id,
        title: this.newPodTitle,
        description: this.newPodDescription,
        coverUrl: this.newPodCoverUrl,
        podType: this.newPodType,
        priceBits: this.newPodType === 'premium' ? this.newPodPrice : 0,
        articles: [],
        collaboratorIds: [],
        createdAt: new Date().toISOString()
      });

      Swal.fire('Sucesso!', 'Sua Cápsula de Dados foi criada.', 'success');
      this.newPodTitle = '';
      this.newPodDescription = '';
      this.newPodCoverUrl = '/images/frostbite_cover.png';
      this.newPodType = 'standard';
    } catch (e: any) {
      Swal.fire('Erro', e.message, 'error');
    }
  }
}
