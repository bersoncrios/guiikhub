import { Component, signal, computed, effect, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import Swal from 'sweetalert2';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { DbService } from '../../core/db/db.service';
import { BlogSettings } from '../../core/models/interfaces';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.scss'
})
export class AdminComponent {
  private readonly router = inject(Router);
  // Navigation
  readonly activeTab = signal<'posts' | 'customize' | 'profile' | 'new-post' | 'collabs' | 'monetization'>('posts');
  readonly mobileNavOpen = signal(false);
  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav()  { this.mobileNavOpen.set(false); }

  // New Post Form
  newPostTitle = '';
  newPostSummary = '';
  newPostContent = '';
  newPostCoverUrl = '/images/cyberpunk_cover.png';
  isUploadingCover = false;
  newPostTags = 'Gamer, Geek, Tech';
  targetBlogId = '';

  // Rich Text Editor
  @ViewChild('richEditor') richEditorRef!: ElementRef<HTMLDivElement>;
  readonly editorHasContent = signal(false);
  
  // Post Editing
  readonly editingArticleId = signal<string | null>(null);
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
    
    this.blogSponsorUrl1 = s.sponsorBannerUrl1 || '';
    this.blogSponsorLink1 = s.sponsorBannerLink1 || '';
    this.blogSponsorUrl2 = s.sponsorBannerUrl2 || '';
    this.blogSponsorLink2 = s.sponsorBannerLink2 || '';
  }

  setTab(tab: 'posts' | 'customize' | 'profile' | 'new-post' | 'collabs' | 'monetization') {
    this.activeTab.set(tab);
    if (tab === 'new-post' && !this.editingArticleId()) {
      // Clear editor when opening the new post tab for a NEW post
      this.clearEditorContent();
      this.newPostTitle = '';
      this.newPostSummary = '';
      this.newPostCoverUrl = '/images/cyberpunk_cover.png';
      this.newPostTags = 'Gamer, Geek, Tech';
      this.targetBlogId = '';
    } else if (tab !== 'new-post') {
      this.editingArticleId.set(null);
    }
  }

  // ─── Rich Text Editor Methods ──────────────────────────────────────────────

  onEditorInput(event: Event) {
    const el = event.target as HTMLDivElement;
    this.newPostContent = el.innerHTML;
    this.editorHasContent.set(el.innerText.trim().length > 0);
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
    const filename = `inline_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    try {
      const s3 = new S3Client({
        endpoint: 'https://s3.tebi.io',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'ztWbSlXugHK1EYjV',
          secretAccessKey: 'IQZDobQP3wmAocfoZpKgfSbUWC9YDG3AumY7TyM5'
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
      bannerUrl: this.blogBannerUrl || '/images/cyberpunk_cover.png',
      sponsorBannerUrl1: this.blogSponsorUrl1,
      sponsorBannerLink1: this.blogSponsorLink1,
      sponsorBannerUrl2: this.blogSponsorUrl2,
      sponsorBannerLink2: this.blogSponsorLink2
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

  applyPreset(presetType: 'cyberpunk' | 'retro' | 'tabletop') {
    if (presetType === 'cyberpunk') {
      this.blogPrimary = '#00f0ff';
      this.blogAccent = '#ff007f';
      this.blogBg = '#08090d';
      this.blogCardBg = '#121420';
      this.blogText = '#f1f5f9';
      this.blogFont = 'Space Grotesk';
      this.blogLayout = 'grid';
      this.blogBannerUrl = '/images/cyberpunk_cover.png';
    } else if (presetType === 'retro') {
      this.blogPrimary = '#39ff14';
      this.blogAccent = '#ffff00';
      this.blogBg = '#0a0d0a';
      this.blogCardBg = '#141a14';
      this.blogText = '#e2f0d9';
      this.blogFont = 'Fira Code';
      this.blogLayout = 'list';
      this.blogBannerUrl = '/images/retro_cover.png';
    } else if (presetType === 'tabletop') {
      this.blogPrimary = '#ffb703';
      this.blogAccent = '#fb8500';
      this.blogBg = '#0f0c08';
      this.blogCardBg = '#1d1912';
      this.blogText = '#eae0d5';
      this.blogFont = 'Outfit';
      this.blogLayout = 'magazine';
      this.blogBannerUrl = '/images/tabletop_cover.png';
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
        updatedAt: new Date().toISOString()
      });
      
      Swal.fire({
        icon: 'success',
        title: isDraft ? 'Rascunho Atualizado!' : 'Alterações Publicadas!',
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
        isDraft
      );

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
          title: isDraft ? 'Rascunho Salvo!' : 'Publicado!',
          text: isDraft ? 'Sua matéria foi salva como rascunho.' : 'Sua nova matéria foi publicada com sucesso! Deseja gerar uma arte para suas redes sociais?',
          showCancelButton: !isDraft,
          confirmButtonText: isDraft ? 'OK' : '📸 Gerar Arte',
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

        if (!isDraft && result.isConfirmed && createdArticle) {
          this.generateSocialImage(createdArticle);
        }
      }
    }
    
    // Clear post form
    this.newPostTitle = '';
    this.newPostSummary = '';
    this.newPostContent = '';
    this.newPostCoverUrl = '/images/cyberpunk_cover.png';
    this.newPostTags = 'Gamer, Geek, Tech';
    this.targetBlogId = '';
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
    this.targetBlogId = art.blogId !== art.authorId ? art.blogId : '';
    
    this.setTab('new-post');
    
    // Set editor content
    setTimeout(() => {
      if (this.richEditorRef?.nativeElement) {
        this.richEditorRef.nativeElement.innerHTML = this.newPostContent;
        this.editorHasContent.set(this.newPostContent.trim().length > 0);
      }
    }, 100);
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
    const filename = `cover_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    
    // Upload endpoint
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    try {
      const s3 = new S3Client({
        endpoint: 'https://s3.tebi.io',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'ztWbSlXugHK1EYjV',
          secretAccessKey: 'IQZDobQP3wmAocfoZpKgfSbUWC9YDG3AumY7TyM5'
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
    const filename = `banner_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    try {
      const s3 = new S3Client({
        endpoint: 'https://s3.tebi.io',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'ztWbSlXugHK1EYjV',
          secretAccessKey: 'IQZDobQP3wmAocfoZpKgfSbUWC9YDG3AumY7TyM5'
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

    const filename = `sponsor${sponsorIndex}_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    try {
      const s3 = new S3Client({
        endpoint: 'https://s3.tebi.io',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'ztWbSlXugHK1EYjV',
          secretAccessKey: 'IQZDobQP3wmAocfoZpKgfSbUWC9YDG3AumY7TyM5'
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
    const filename = `avatar_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '')}`;
    const uploadUrl = `https://s3.tebi.io/guiikhub/${filename}`;

    try {
      const s3 = new S3Client({
        endpoint: 'https://s3.tebi.io',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'ztWbSlXugHK1EYjV',
          secretAccessKey: 'IQZDobQP3wmAocfoZpKgfSbUWC9YDG3AumY7TyM5'
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

    try {
      const response = await fetch(targetUrl, { mode: 'cors' });
      if (!response.ok) throw new Error('CORS fail');
      const blob = await response.blob();
      if (!blob.type.startsWith('image/')) throw new Error('Not an image');
      return await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      // Usar o wsrv.nl para contornar o CORS, e fazer o fetch MANUALMENTE do wsrv.nl
      try {
        const proxyUrl = 'https://wsrv.nl/?url=' + encodeURIComponent(targetUrl) + '&output=webp';
        const response = await fetch(proxyUrl, { mode: 'cors' });
        if (!response.ok) throw new Error('Proxy fail');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('Proxy returned non-image');
        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(blob);
        });
      } catch (proxyError) {
        return url; // último fallback
      }
    }
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
    
    Swal.fire({ title: 'Preparando Arte...', text: 'Baixando imagens em alta resolução...', showConfirmButton: false, allowOutsideClick: false, background: '#121420', color: '#f1f5f9' });
    Swal.showLoading();

    // Convert URLs to Base64 to ensure html2canvas renders them without network issues
    const coverBase64 = await this.urlToBase64(article.coverUrl);
    const authorAvatarBase64 = await this.urlToBase64(article.authorAvatarUrl);
    
    const currentUser = this.db.currentUser();
    const blogAvatarBase64 = await this.urlToBase64(currentUser?.avatarUrl);

    // Create a safe copy of the article for the template
    const safeArticle = {
      ...article,
      coverUrl: coverBase64,
      authorAvatarUrl: authorAvatarBase64,
      // Inject blog variables
      _blogAvatarBase64: blogAvatarBase64,
      _blogName: currentUser?.blogSettings?.title || currentUser?.displayName
    };

    this.storyPreviewArticle.set(safeArticle);
    
    // Give Angular a tick to render the off-screen template with new base64 images
    setTimeout(async () => {
      const templateId = isFeed ? 'feed-template' : 'story-template';
      const element = document.getElementById(templateId);
      if (!element) return;
      
      try {
        Swal.update({ title: 'Baixando Imagens e Desenhando...' });
        
        // Wait EXPLICITLY for all images to completely load their data before html2canvas touches them
        const images = Array.from(element.querySelectorAll('img'));
        await Promise.all(images.map(img => {
          if (img.complete && img.naturalHeight !== 0) return Promise.resolve();
          return new Promise(resolve => {
            img.onload = resolve;
            img.onerror = resolve; // Continue even if error
          });
        }));

        Swal.update({ title: 'Gerando o arquivo final...' });

        const html2canvas = (await import('html2canvas')).default;
        const canvas = await html2canvas(element, {
          scale: 2, // High resolution
          useCORS: true,
          backgroundColor: '#0d0e15',
          logging: false
        });
        
        const link = document.createElement('a');
        const prefix = isFeed ? 'feed' : 'story';
        link.download = `${prefix}-${article.slug || 'post'}.png`;
        link.href = canvas.toDataURL('image/png', 0.95);
        link.click();
        
        this.storyPreviewArticle.set(null);
        Swal.close();
        
        Swal.fire({
          icon: 'success',
          title: 'Arte Pronta!',
          text: 'Sua imagem foi gerada com sucesso!',
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
    }, 500); // 500ms for images to render
  }

}
