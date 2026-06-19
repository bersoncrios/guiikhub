import { Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { DbService } from '../../core/db/db.service';

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
  public readonly db = inject(DbService);

  // Convert route params to a Signal
  private readonly params = toSignal(this.route.params);
  
  // Extract username from params
  readonly username = computed(() => this.params()?.['username'] || '');

  // Find user by username
  readonly blogUser = computed(() => {
    const name = this.username().toLowerCase().trim();
    if (!name) return null;
    return this.db.users().find(u => u.username === name) || null;
  });

  // Get articles of the user
  readonly blogArticles = computed(() => {
    const user = this.blogUser();
    if (!user) return [];
    return this.db.articles().filter(art => art.authorId === user.id);
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

    return {
      '--blog-bg': s.bgColor,
      '--blog-card-bg': s.cardBgColor,
      '--blog-border': 'rgba(255, 255, 255, 0.08)',
      '--blog-primary': s.primaryColor,
      '--blog-accent': s.accentColor,
      '--blog-text': s.textColor,
      '--blog-text-muted': '#94a3b8',
      '--blog-font-family': fontStr,
      '--blog-glow': `0 0 20px ${s.accentColor}40`
    } as Record<string, string>;
  });

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
