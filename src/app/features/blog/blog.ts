import { Component, computed, inject, effect, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { Title, Meta } from '@angular/platform-browser';
import { DbService } from '../../core/db/db.service';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-blog',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './blog.html',
  styleUrl: './blog.scss'
})
export class BlogComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly titleService = inject(Title);
  private readonly metaService = inject(Meta);
  public readonly db = inject(DbService);

  // Convert route params to a Signal
  private readonly params = toSignal(this.route.params);
  
  // Extract username from params
  readonly username = computed(() => {
    const p = this.params();
    return p ? p['username'] : this.route.snapshot.params['username'];
  });

  // Find user by username
  readonly blogUser = computed(() => {
    const name = this.username().toLowerCase().trim();
    if (!name) return null;
    return this.db.users().find(u => u.username === name) || null;
  });

  // Selected Section Filter state
  readonly selectedSection = signal<string>('Tudo');

  // List of sections defined by the user
  readonly blogSections = computed(() => {
    const user = this.blogUser();
    if (!user) return [];
    return user.blogSettings?.sections || ['Geral', 'Tech', 'Quadrinhos'];
  });

  // Get articles of the user's blog
  readonly blogArticles = computed(() => {
    const user = this.blogUser();
    if (!user) return [];
    const allArticles = this.db.articles().filter(art => 
      (art.blogId || art.authorId) === user.id && 
      (!art.status || art.status === 'published') &&
      (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now())
    );
    
    const filter = this.selectedSection();
    if (filter === 'Tudo') {
      return allArticles;
    }
    return allArticles.filter(art => {
      if (filter === 'Geral') {
        return art.section === 'Geral' || !art.section;
      }
      return art.section === filter;
    });
  });

  readonly activeStatus = computed(() => {
    const user = this.blogUser();
    if (!user) return null;
    const now = Date.now();
    return this.db.blogStatuses()
      .filter(s => s.blogId === user.id && new Date(s.expiresAt).getTime() > now)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  });


  // Build custom CSS variables map for the wrapper
  readonly customStyleVariables = computed(() => {
    const user = this.blogUser();
    if (!user) return {};
    const s = user.blogSettings;
    
    // Map font choices to css strings
    let fontStr = 'var(--font-sans)';
    if (s.fontFamily === 'Space Grotesk') fontStr = 'var(--font-display)';
    else if (s.fontFamily === 'Fira Code') fontStr = 'var(--font-mono)';

    const vars: Record<string, string> = {
      '--blog-bg': s.bgColor,
      '--blog-card-bg': s.cardBgColor,
      '--blog-border': 'rgba(255, 255, 255, 0.08)',
      '--blog-primary': s.primaryColor,
      '--blog-accent': s.accentColor,
      '--blog-text': s.textColor,
      '--blog-text-muted': '#94a3b8',
      '--blog-font-family': fontStr,
      '--blog-glow': `0 0 20px ${s.accentColor}40`
    };

    // Overlay active shop theme settings if custom JSON config
    if (user.activeTheme && user.activeTheme.startsWith('{')) {
      try {
        const config = JSON.parse(user.activeTheme);
        if (config.primaryColor) vars['--blog-primary'] = config.primaryColor;
        if (config.bgColor) vars['--blog-bg'] = config.bgColor;
        if (config.cardBgColor) vars['--blog-card-bg'] = config.cardBgColor;
        if (config.textColor) vars['--blog-text'] = config.textColor;
        if (config.accentColor) vars['--blog-accent'] = config.accentColor;
        else if (config.primaryColor) vars['--blog-accent'] = config.primaryColor;
        
        if (config.primaryColor) {
          vars['--blog-glow'] = `0 0 20px ${config.primaryColor}50`;
        }
      } catch (e) {
        console.error('Error parsing custom activeTheme variables:', e);
      }
    }

    return vars;
  });

  private readonly seo = inject(SeoService);
  private viewRegisteredForUserId = '';

  constructor() {
    // Update browser tab title and meta tags when blog user loads
    effect(() => {
      const user = this.blogUser();
      if (user) {
        if (this.viewRegisteredForUserId !== user.id) {
          this.db.registerBlogView(user.id);
          this.viewRegisteredForUserId = user.id;
        }

        const blogTitle = user.blogSettings?.title || user.displayName;
        const description = user.blogSettings?.tagline || user.bio || 'Confira o meu blog no GuiikHub!';
        const imageUrl = user.blogSettings?.bannerUrl || user.bannerUrl || 'https://guiikhub.com/images/logo-guiikhub.png';
        
        this.seo.updateTags({
          title: blogTitle,
          description: description,
          image: imageUrl,
          type: 'profile',
          route: `/b/${user.username}`
        });

      } else if (this.username()) {
        const fallbackTitle = `@${this.username()}`;
        this.seo.updateTags({ title: fallbackTitle });
      }
    });
  }

  toggleFollow(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    const user = this.blogUser();
    if (user) {
      this.db.toggleFollow(user.id);
    }
  }
}
