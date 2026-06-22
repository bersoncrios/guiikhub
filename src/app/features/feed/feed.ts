import { Component, signal, computed, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, Router } from '@angular/router';
import { DbService } from '../../core/db/db.service';
import { Article, User } from '../../core/models/interfaces';
import { SeoService } from '../../core/services/seo.service';

@Component({
  selector: 'app-feed',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './feed.html',
  styleUrl: './feed.scss'
})
export class FeedComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly seo = inject(SeoService);
  readonly searchQuery = signal('');
  readonly selectedTag = signal<string | null>(null);
  readonly mobileNavOpen = signal(false);

  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav()  { this.mobileNavOpen.set(false); }

  // Filtered articles
  readonly filteredArticles = computed(() => {
    let list = this.db.articles().filter(art => !art.status || art.status === 'published');
    const query = this.searchQuery().toLowerCase().trim();
    const tag = this.selectedTag();

    if (query) {
      list = list.filter(art => 
        art.title.toLowerCase().includes(query) || 
        art.summary.toLowerCase().includes(query) ||
        art.tags.some(t => t.toLowerCase().includes(query))
      );
    }

    if (tag) {
      list = list.filter(art => art.tags.includes(tag));
    }

    return list;
  });

  // Get all unique tags
  readonly allTags = computed(() => {
    const tags = new Set<string>();
    this.db.articles()
      .filter(art => !art.status || art.status === 'published')
      .forEach(art => {
        art.tags.forEach(t => tags.add(t));
      });
    return Array.from(tags);
  });

  // Creators list (excluding current user)
  readonly otherCreators = computed(() => {
    const current = this.db.currentUser();
    return this.db.users().filter(u => !current || u.id !== current.id);
  });

  constructor(public db: DbService) {}

  ngOnInit() {
    this.seo.updateTags({
      title: 'GuiikHub',
      description: 'Descubra e crie artigos incríveis sobre tudo o que você ama.',
      route: ''
    });
  }

  selectTag(tag: string | null) {
    this.selectedTag.set(tag);
  }

  toggleLike(event: Event, articleId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.db.toggleLike(articleId);
  }

  toggleFollow(event: Event, creatorId: string) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.db.isAuthenticated()) {
      this.router.navigate(['/auth']);
      return;
    }
    this.db.toggleFollow(creatorId);
  }
}
