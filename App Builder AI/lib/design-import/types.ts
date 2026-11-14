export type DesignOutlineNode = {
  name: string;
  type: string;
  layout?: string;
  size?: string;
  text?: string;
  fill?: string;
  computedStyle?: Record<string, string>;
  screenshotPath?: string;
  children?: DesignOutlineNode[];
};

export type DesignFrame = {
  id: string;
  name: string;
  width?: number;
  height?: number;
  outline: DesignOutlineNode;
  screenshotPath?: string;
};

export type DesignColor = { hex: string; count: number };

export type DesignTextStyle = {
  fontFamily: string;
  fontSize?: number;
  fontWeight?: number;
  count: number;
};

export type DesignImage = { nodeId: string; name: string; url: string; localPath?: string };

export type ReferenceContext = {
  designTokens: {
    colors: string[];
    fonts: string[];
    spacing: string[];
    borderRadius: string[];
  };
  sections: {
    id: string;
    name: string;
    outline: DesignOutlineNode;
    screenshotPath: string;
  }[];
  fullPageScreenshotPath?: string;
};

export type DesignSpec = {
  source: 'figma' | 'url' | 'screenshot';
  name: string;
  sourceUrl?: string;
  frames: DesignFrame[];
  colors: DesignColor[];
  textStyles: DesignTextStyle[];
  components: string[];
  headings: string[];
  fonts: string[];
  images: DesignImage[];
  notes: string[];
  referenceContext?: ReferenceContext;
};

export function emptySpec(source: DesignSpec['source'], name: string): DesignSpec {
  return {
    source,
    name,
    frames: [],
    colors: [],
    textStyles: [],
    components: [],
    headings: [],
    fonts: [],
    images: [],
    notes: [],
  };
}
