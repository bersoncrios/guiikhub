import { Component, signal, computed, inject, OnInit, effect } from '@angular/core';
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

  // Pagination State
  readonly currentPage = signal(1);
  readonly pageSize = 3;

  readonly paginatedArticles = computed(() => {
    const list = this.filteredArticles();
    const start = (this.currentPage() - 1) * this.pageSize;
    return list.slice(start, start + this.pageSize);
  });

  readonly totalPages = computed(() => Math.ceil(this.filteredArticles().length / this.pageSize));

  readonly pageNumbers = computed(() => {
    const pages: number[] = [];
    const total = this.totalPages();
    const current = this.currentPage();
    let start = Math.max(1, current - 2);
    let end = Math.min(total, start + 4);
    if (end - start < 4) start = Math.max(1, end - 4);
    for (let i = start; i <= end; i++) pages.push(i);
    return pages;
  });

  // Spotlight Article computation — only shows if dataDestaque is today
  readonly spotlightArticle = computed(() => {
    const spotlight = this.db.holofoteAtivo();
    if (!spotlight || !spotlight.postDestaqueId) return null;
    const todayStr = new Date().toISOString().split('T')[0];
    if (spotlight.dataDestaque !== todayStr) return null;
    return this.db.articles().find(art => art.id === spotlight.postDestaqueId) || null;
  });
  readonly selectedTag = signal<string | null>(null);
  readonly mobileNavOpen = signal(false);

  toggleMobileNav() { this.mobileNavOpen.update(v => !v); }
  closeMobileNav() { this.mobileNavOpen.set(false); }

  readonly activeFeedTab = signal<'discover' | 'following'>('discover');

  // Recommendation algorithm for "Descobrir" feed
  readonly discoverArticles = computed(() => {
    const me = this.db.currentUser();
    const allArticles = this.db.articles().filter(art =>
      (!art.status || art.status === 'published') &&
      (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now())
    );

    if (!me) {
      // Guest users: sort by popularity and time decay
      return [...allArticles].sort((a, b) => {
        const scoreA = (a.likesCount * 2 + a.commentsCount * 3);
        const hoursA = (Date.now() - new Date(a.createdAt).getTime()) / (1000 * 60 * 60);
        const finalScoreA = scoreA / (1 + hoursA * 0.05);

        const scoreB = (b.likesCount * 2 + b.commentsCount * 3);
        const hoursB = (Date.now() - new Date(b.createdAt).getTime()) / (1000 * 60 * 60);
        const finalScoreB = scoreB / (1 + hoursB * 0.05);

        return finalScoreB - finalScoreA;
      });
    }

    // Authenticated users: interest match, new creator boost, popularity, recency decay
    const likedIds = this.db.likes()
      .filter(l => l.userId === me.id)
      .map(l => l.articleId);

    const favoriteTags = new Map<string, number>();
    this.db.articles()
      .filter(art => likedIds.includes(art.id))
      .forEach(art => {
        art.tags?.forEach(tag => {
          favoriteTags.set(tag, (favoriteTags.get(tag) || 0) + 1);
        });
      });

    const scored = allArticles.map(art => {
      let tagScore = 0;
      art.tags?.forEach(tag => {
        tagScore += (favoriteTags.get(tag) || 0) * 10;
      });

      const isOwnPost = (art.blogId || art.authorId) === me.id;
      const isFollowed = this.db.isFollowing(art.blogId || art.authorId);

      let creatorBoost = 0;
      if (!isOwnPost && !isFollowed) {
        creatorBoost = 15;
      }

      const popularity = art.likesCount * 2 + art.commentsCount * 3;
      const hours = (Date.now() - new Date(art.createdAt).getTime()) / (1000 * 60 * 60);

      const rawScore = tagScore + creatorBoost + popularity + 10;
      const finalScore = rawScore / (1 + hours * 0.02);

      return { article: art, score: finalScore };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .map(item => item.article);
  });

  // "Seguindo" feed
  readonly followingArticles = computed(() => {
    const me = this.db.currentUser();
    if (!me) return [];
    return this.db.articles().filter(art => {
      const isPublished = (!art.status || art.status === 'published') &&
        (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now());
      const isFollowed = this.db.isFollowing(art.blogId || art.authorId);
      return isPublished && isFollowed;
    });
  });

  // Filtered articles based on selected tab and search/tag parameters
  readonly filteredArticles = computed(() => {
    let list = this.activeFeedTab() === 'discover' ? this.discoverArticles() : this.followingArticles();
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
      .filter(art =>
        (!art.status || art.status === 'published') &&
        (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now())
      )
      .forEach(art => {
        art.tags.forEach(t => tags.add(t));
      });
    return Array.from(tags);
  });

  // Recommended creators list based on engagement (views, posts, likes, comments)
  readonly recommendedCreators = computed(() => {
    const me = this.db.currentUser();
    const allUsers = this.db.users();
    const allArticles = this.db.articles().filter(art =>
      (!art.status || art.status === 'published') &&
      (!art.scheduledAt || new Date(art.scheduledAt).getTime() <= Date.now())
    );

    // Filter out: current user and creators the user already follows
    const candidates = allUsers.filter(u => {
      if (me && u.id === me.id) return false;
      if (me && this.db.isFollowing(u.id)) return false;
      return true;
    });

    // Score candidates based on engagement metrics
    const scored = candidates.map(u => {
      const creatorArticles = allArticles.filter(art => (art.blogId || art.authorId) === u.id);
      const articleCount = creatorArticles.length;

      let totalLikes = 0;
      let totalComments = 0;
      creatorArticles.forEach(art => {
        totalLikes += art.likesCount || 0;
        totalComments += art.commentsCount || 0;
      });

      const views = u.viewsCount || 0;

      // Engagement scoring formula
      const score = (views * 1) + (articleCount * 15) + (totalLikes * 8) + (totalComments * 12);

      return { creator: u, score };
    });

    // Sort by score descending and take top 5
    return scored
      .sort((a, b) => b.score - a.score)
      .map(item => item.creator)
      .slice(0, 5);
  });

  constructor(public db: DbService) {
    // Reset page to 1 when filters or tabs change
    effect(() => {
      this.filteredArticles();
      this.currentPage.set(1);
    });
  }

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

  getUserBadges(user: any): any[] {
    if (!user || !user.unlockedBadges) return [];
    return this.db.badges().filter(b => user.unlockedBadges.includes(b.id));
  }
}
