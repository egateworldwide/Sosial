export type PostSizeId = 'square' | 'portrait' | 'story' | 'landscape' | 'a4';

export interface PostSize {
  id: PostSizeId;
  label: string;
  hint: string;
  width: number;
  height: number;
  ratio: number; // height / width
}

export type BgType = 'solid' | 'grid' | 'dots' | 'stripes' | 'zigzag' | 'waves' | 'hearts' | 'stars' | 'crosses' | 'doodle' | 'image';

export interface BackgroundStyle {
  type: BgType;
  color: string; // base
  patternColor: string; // lines / dots
  patternSize: number; // 8 - 48
  patternOpacity: number; // 0 - 1
  imageUri?: string;
  imageOpacity?: number; // overlay dim 0-1
  // mix: optional second pattern blended on top
  mixEnabled: boolean;
  mixType?: BgType;
  mixColor?: string;
  mixOpacity?: number;
}

export type TitlePosition = 'top' | 'bottom' | 'none';
export type PfpCorner = 'tl' | 'tr' | 'bl' | 'br';

export interface PostTitle {
  text: string;
  position: TitlePosition;
  color: string;
  size: number; // 18-48
  align: 'left' | 'center' | 'right';
  font: FontId;
  bold: boolean;
  italic: boolean;
  subtitle?: string; // smaller line rendered below the title
  subtitleSize?: number;
  subtitleColor?: string;
}

export type FontId = 'inter' | 'jakarta' | 'space-grotesk' | 'playfair' | 'crimson' | 'system';

export interface PfpStyle {
  uri?: string;
  pfpY: 'top' | 'bottom';
  size: number; // 40-120
  shape: 'circle' | 'rounded';
  socialPos: 'below' | 'right' | 'left';
  badgeBg: boolean;
  badgeRows: 1 | 2;
  handleColor: string; // social handle text color
  handleSize: number; // social handle text size 6-14
  iconSize: number; // social icon circle size 12-28
  iconOutline: boolean; // outline vs filled circle
  socialGap: number; // spacing between pfp and badges + between badges 0-16
  align: 'left' | 'center' | 'right';
  borderW: number; // pfp border thickness 0-6
  username?: string; // universal display name under the photo
}

export type SocialPlatform = 'instagram' | 'tiktok' | 'threads' | 'x' | 'facebook' | 'youtube' | 'whatsapp';

export interface SocialLink {
  id: string;
  platform: SocialPlatform;
  handle: string;
  visible: boolean;
  font: FontId;
  bold: boolean;
  italic: boolean;
}

export type BlockType = 'bullets' | 'numbered' | 'table' | 'bar' | 'pie' | 'vbar' | 'free' | 'image';

export interface ContentBlock {
  id: string;
  type: BlockType;
  heading?: string;
  items: string[]; // bullets / numbered / free lines
  table?: string[][]; // rows x cols
  chart?: { label: string; value: number; color?: string }[];
  imageUri?: string; // image block source
  imageH?: number; // custom height in canvas units
  imageAspect?: 'square' | 'wide' | 'custom'; // crop frame: 1:1, 16:9, or custom height
  imageFocus?: number; // 0-8 focal cell (3x3 grid), 4 = center
  /** Non-destructive manual crop: zoom (1-3) + pan (-1..1 each axis). */
  imageCrop?: { zoom: number; x: number; y: number };
  textColor?: string;
}

export interface PostPage {
  id: string;
  background: BackgroundStyle;
  title: PostTitle;
  pfp: PfpStyle;
  socials: SocialLink[];
  blocks: ContentBlock[];
  font: FontId; // project-level font
  cardStyle: CardStyle; // content card template
  cardColor?: string; // content card background
  cardH?: number | null; // fixed card height px, null = auto fill
  cardY?: 'top' | 'middle' | 'bottom'; // card placement in free space (fixed height)
  stickToCard?: boolean; // pfp+socials group attaches to the card and follows it
  contentScale?: number; // content text zoom, 1 = 100%
  verified?: boolean; // show verified check after handle in card chrome
  caption?: string;
  scheduledAt?: number; // reminder fire time (ms), undefined = not scheduled
  scheduledPlatform?: string; // legacy single channel — superseded by scheduledPlatforms
  scheduledPlatforms?: string[]; // channel keys, ['any'] = anywhere
}

export type CardStyle = 'minimal' | 'facebook' | 'x' | 'instagram' | 'threads';

export interface QuickPost {
  id: string;
  name: string;
  sizeId: PostSizeId;
  font: FontId; // overall project font for all content
  createdAt: number;
  pages: PostPage[];
}

export type EditorStep =
  | 'background'
  | 'title'
  | 'pfp'
  | 'content'
  | 'pages';
