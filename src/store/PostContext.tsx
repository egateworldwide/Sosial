import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { BackgroundStyle, ContentBlock, FontId, PfpCorner, PfpStyle, PostPage, PostSizeId, PostTitle, QuickPost, SocialLink, TitlePosition } from '../types';
import { POST_SIZES, uid } from '../constants';

export function defaultBackground(): BackgroundStyle {
  return {
    type: 'dots',
    color: '#F5F1E8',
    patternColor: '#111111',
    patternSize: 22,
    patternOpacity: 0.12,
    mixEnabled: false,
    mixType: 'grid',
    mixColor: '#4D7CFE',
    mixOpacity: 0.12,
    imageOpacity: 0.35,
  };
}

export function defaultTitle(): PostTitle {
  return { text: 'My Sosial title', position: 'top', color: '#111111', size: 28, align: 'center', font: 'jakarta', bold: true, italic: false, subtitle: '', subtitleSize: 15, subtitleColor: '#57534E' };
}

export function defaultPfp(): PfpStyle {
  return { pfpY: 'bottom', size: 40, shape: 'circle', socialPos: 'right', badgeBg: true,
badgeRows: 1, handleColor: '#FFFFFF', handleSize: 7.5, iconSize: 24, iconOutline: false, socialGap: 6, align: 'center',
borderW: 0, username: '' };
}

export function defaultBlocks(): ContentBlock[] {
  return [
    { id: uid('b'), type: 'bullets', heading: '3 quick wins', items: ['One clear idea per slide', 'Big text, lots of whitespace', 'End with your handle'], textColor: '#111111' },
  ];
}

export function defaultSocials(): SocialLink[] {
  return [
    { id: uid('s'), platform: 'instagram', handle: '@yourhandle', visible: true, font: 'jakarta', bold: true, italic: false },
    { id: uid('s'), platform: 'tiktok', handle: '@yourhandle', visible: false, font: 'jakarta', bold: true, italic: false },
    { id: uid('s'), platform: 'x', handle: '@yourhandle', visible: false, font: 'jakarta', bold: true, italic: false },
  ];
}

export function defaultPage(font: FontId = 'jakarta'): PostPage {
  return {
    id: uid('page'),
    background: defaultBackground(),
    title: defaultTitle(),
    pfp: defaultPfp(),
    socials: defaultSocials(),
    blocks: defaultBlocks(),
    font,
    cardStyle: 'minimal',
    showWatermark: true,
    caption: '',
  };
}

interface PostStore {
  post: QuickPost | null;
  pageIndex: number;
  page: PostPage | null;
  createPost: (name: string, sizeId: PostSizeId, font: FontId) => void;
  loadPost: (p: QuickPost) => void;
  clearPost: () => void;
  renamePost: (name: string) => void;
  setPageIndex: (i: number) => void;
  patchPage: (patch: Partial<PostPage>) => void;
  patchPageById: (id: string, patch: Partial<PostPage>) => void;
  patchBackground: (patch: Partial<BackgroundStyle>) => void;
  patchTitle: (patch: Partial<PostTitle>) => void;
  patchPfp: (patch: Partial<PfpStyle>) => void;
  setSocials: (s: SocialLink[]) => void;
  setBlocks: (b: ContentBlock[]) => void;
  setPages: (pages: PostPage[]) => void;
  duplicatePage: () => void;
  addPage: () => void;
  deletePage: (id: string) => void;
  setPageOrder: (ids: string[]) => void;
  sizeRatio: number;
}

const Ctx = createContext<PostStore | null>(null);

export function PostProvider({ children }: { children: React.ReactNode }) {
  const [post, setPost] = useState<QuickPost | null>(null);
  const [pageIndex, setPageIndex] = useState(0);

  const createPost = useCallback((name: string, sizeId: PostSizeId, font: FontId) => {
    setPost({ id: uid('post'), name: name || 'Untitled', sizeId, font, createdAt: Date.now(), pages: [defaultPage(font)] });
    setPageIndex(0);
  }, []);

  const loadPost = useCallback((p: QuickPost) => {
    setPost(p);
    setPageIndex(0);
  }, []);

  const clearPost = useCallback(() => {
    setPost(null);
    setPageIndex(0);
  }, []);

  const renamePost = useCallback((name: string) => {
    const v = name.trim();
    if (!v) return;
    setPost((prev) => (prev ? { ...prev, name: v } : prev));
  }, []);

  // keep a ref-like for pageIndex inside updater
  const pageIndexRef = React.useRef(pageIndex);
  pageIndexRef.current = pageIndex;

  const patchPage = useCallback((patch: Partial<PostPage>) => {
    const idx = pageIndexRef.current;
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) => (i === idx ? { ...pg, ...patch } : pg));
      return { ...prev, pages };
    });
  }, []);

  const patchPageById = useCallback((id: string, patch: Partial<PostPage>) => {
    setPost((prev) => {
      if (!prev) return prev;
      return { ...prev, pages: prev.pages.map((pg) => (pg.id === id ? { ...pg, ...patch } : pg)) };
    });
  }, []);

  const patchBackground = useCallback((patch: Partial<BackgroundStyle>) => {
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) =>
        i === pageIndexRef.current ? { ...pg, background: { ...pg.background, ...patch } } : pg
      );
      return { ...prev, pages };
    });
  }, []);

  const patchTitle = useCallback((patch: Partial<PostTitle>) => {
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) =>
        i === pageIndexRef.current ? { ...pg, title: { ...pg.title, ...patch } } : pg
      );
      return { ...prev, pages };
    });
  }, []);

  const patchPfp = useCallback((patch: Partial<PfpStyle>) => {
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) =>
        i === pageIndexRef.current ? { ...pg, pfp: { ...pg.pfp, ...patch } } : pg
      );
      return { ...prev, pages };
    });
  }, []);

  const setSocials = useCallback((s: SocialLink[]) => {
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) => (i === pageIndexRef.current ? { ...pg, socials: s } : pg));
      return { ...prev, pages };
    });
  }, []);

  const setBlocks = useCallback((b: ContentBlock[]) => {
    setPost((prev) => {
      if (!prev) return prev;
      const pages = prev.pages.map((pg, i) => (i === pageIndexRef.current ? { ...pg, blocks: b } : pg));
      return { ...prev, pages };
    });
  }, []);

  /** Bulk-replace the whole page list (AI generate / apply). Clamps the cursor. */
  const setPages = useCallback((pages: PostPage[]) => {
    if (pages.length === 0) return;
    setPost((prev) => (prev ? { ...prev, pages } : prev));
    setPageIndex((i) => Math.min(i, Math.max(0, pages.length - 1)));
  }, []);

  const duplicatePage = useCallback(() => {
    setPost((prev) => {
      if (!prev) return prev;
      const cur = prev.pages[pageIndexRef.current];
      if (!cur) return prev;
      const copy: PostPage = JSON.parse(JSON.stringify(cur));
      copy.id = uid('page');
      copy.blocks = copy.blocks.map((b) => ({ ...b, id: uid('b') }));
      delete copy.scheduledAt;
      delete copy.scheduledPlatform;
      const pages = [...prev.pages];
      pages.splice(pageIndexRef.current + 1, 0, copy);
      return { ...prev, pages };
    });
    setPageIndex((i) => i + 1);
  }, []);

  const addPage = useCallback(() => {
    setPost((prev) => {
      if (!prev) return prev;
      return { ...prev, pages: [...prev.pages, defaultPage(prev.font)] };
    });
    setPost((prev) => prev); // no-op to trigger
  }, []);

  const deletePage = useCallback((id: string) => {
    setPost((prev) => {
      if (!prev) return prev;
      if (prev.pages.length <= 1) return prev;
      return { ...prev, pages: prev.pages.filter((p) => p.id !== id) };
    });
    setPageIndex((i) => Math.max(0, i - 1));
  }, []);

  const setPageOrder = useCallback((ids: string[]) => {
    if (!post) return;
    const byId = new Map(post.pages.map((p) => [p.id, p]));
    const pages = ids.map((id) => byId.get(id)).filter((p) => !!p) as PostPage[];
    if (pages.length !== post.pages.length) return;
    const curId = post.pages[pageIndex]?.id;
    setPost({ ...post, pages });
    setPageIndex(Math.max(0, pages.findIndex((p) => p.id === curId)));
  }, [post, pageIndex]);

  const value = useMemo<PostStore>(() => {
    const page = post?.pages[pageIndex] ?? null;
    const size = POST_SIZES.find((s) => s.id === post?.sizeId);
    return {
      post, pageIndex, page, createPost, loadPost, clearPost, renamePost,
      setPageIndex, patchPage, patchPageById, patchBackground, patchTitle, patchPfp,
      setSocials, setBlocks, setPages, duplicatePage, addPage, deletePage, setPageOrder,
      sizeRatio: size?.ratio ?? 1,
    };
  }, [post, pageIndex, createPost, loadPost, clearPost, renamePost, patchPage, patchPageById, patchBackground, patchTitle, patchPfp, setSocials, setBlocks, setPages, duplicatePage, addPage, deletePage, setPageOrder]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePost(): PostStore {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePost must be used inside PostProvider');
  return v;
}

// Re-export types used by editors to avoid circular imports
export type { PfpCorner, TitlePosition };
