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
  readonly activeTab = signal<'posts' | 'customize' | 'profile' | 'new-post' | 'collabs'>('posts');
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
  }

  setTab(tab: 'posts' | 'customize' | 'profile' | 'new-post' | 'collabs') {
    this.activeTab.set(tab);
    if (tab === 'new-post') {
      // Clear editor when opening the new post tab
      setTimeout(() => {
        if (this.richEditorRef?.nativeElement) {
          this.richEditorRef.nativeElement.innerHTML = '';
          this.editorHasContent.set(false);
        }
      }, 0);
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
      bannerUrl: this.blogBannerUrl || '/images/cyberpunk_cover.png'
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

  createPost() {
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

    this.db.addArticle(
      this.newPostTitle,
      this.newPostSummary || this.newPostContent.substring(0, 150) + '...',
      this.newPostContent,
      this.newPostCoverUrl,
      tags,
      this.targetBlogId
    );

    Swal.fire({
      icon: 'success',
      title: 'Publicado!',
      text: 'Sua nova matéria foi publicada com sucesso!',
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
    
    // Clear post form
    this.newPostTitle = '';
    this.newPostSummary = '';
    this.newPostContent = '';
    this.newPostCoverUrl = '/images/cyberpunk_cover.png';
    this.newPostTags = 'Gamer, Geek, Tech';
    this.targetBlogId = '';
    this.clearEditorContent();
    
    this.setTab('posts');
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

  async removeCollaborator(collabId: string) {
    const res = await Swal.fire({
      title: 'Remover Colaborador?',
      text: 'Ele não poderá mais postar no seu blog.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Sim',
      cancelButtonText: 'Cancelar',
      background: '#121420',
      color: '#f1f5f9'
    });
    if (res.isConfirmed) {
      await this.db.removeCollaborator(collabId);
      Swal.fire({ icon: 'success', title: 'Removido!', timer: 1200, showConfirmButton: false, background: '#121420', color: '#f1f5f9' });
    }
  }

}
