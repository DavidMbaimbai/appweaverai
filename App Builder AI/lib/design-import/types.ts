export type DesignOutlineNode = {
  name: string;
  type: string;
  layout?: string;
  size?: string;
  text?: string;
  fill?: string;
  children?: DesignOutlineNode[];
};

export type DesignFrame = {
  id: string;
  name: string;
  width?: number;
  height?: number;
  outline: DesignOutlineNode;
};

export type DesignColor = { hex: string; count: number };

export type DesignTextStyle = {
  fontFamily: string;
  fontSize?: number;
  fontWeight?: number;
  count: number;
};

export type DesignImage = { nodeId: string; name: string; url: string };

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
