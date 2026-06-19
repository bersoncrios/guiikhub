import { Component, signal, computed, effect, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  readonly activeTab = signal<'posts' | 'customize' | 'profile' | 'new-post'>('posts');
  readonly mobileNavOpen = signal(false);
  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav()  { this.mobileNavOpen.set(false); }

  // New Post Form
  newPostTitle = '';
  newPostSummary = '';
  newPostContent = '';
  newPostCoverUrl = '/images/cyberpunk_cover.png';
  newPostTags = 'Gamer, Geek, Tech';

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

  // Profile Form
  profileName = '';
  profileBio = '';
  profileAvatar = '';
  profileUsername = '';

  // Filter user's own articles
  readonly myArticles = computed(() => {
    const user = this.db.currentUser();
    if (!user) return [];
    return this.db.articles().filter(art => art.authorId === user.id);
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

  setTab(tab: 'posts' | 'customize' | 'profile' | 'new-post') {
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

  insertImage() {
    const url = prompt('URL da imagem:');
    if (url) {
      document.execCommand('insertImage', false, url);
      this.richEditorRef.nativeElement.focus();
      this.syncEditorContent();
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
      tags
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
    this.clearEditorContent();
    
    this.setTab('posts');
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

}
