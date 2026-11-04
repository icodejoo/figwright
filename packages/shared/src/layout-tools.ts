/** 装箱矩形，仅传尺寸和标识，不传节点树。 */
export interface LayoutBox {
  /** 块标识。 */
  id: string;
  /** 块宽。 */
  width: number;
  /** 块高。 */
  height: number;
}

/** 一次插件属性修改；未提供的属性保持原值。 */
export interface LayoutChange {
  /** 节点标识。 */
  id: string;
  /** 新父级；回退时使用原父级。 */
  parentId?: string;
  /** 原兄弟顺序。 */
  childIndex?: number;
  /** 可见性；保留清空外壳以便回退。 */
  visible?: boolean;
  /** 横坐标。 */
  x?: number;
  /** 纵坐标。 */
  y?: number;
  /** 宽度。 */
  width?: number;
  /** 高度。 */
  height?: number;
  /** 水平尺寸策略。 */
  layoutSizingHorizontal?: 'HUG' | 'FIXED' | 'FILL';
  /** 垂直尺寸策略。 */
  layoutSizingVertical?: 'HUG' | 'FIXED' | 'FILL';
  /** 自动布局模式。 */
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  /** 文本尺寸策略；必须最后写。 */
  textAutoResize?: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE';
}

/** 聚簇内成员的相对偏移。 */
export interface LayoutMember {
  /** 节点标识。 */
  id: string;
  /** 相对横坐标。 */
  x: number;
  /** 相对纵坐标。 */
  y: number;
}

/** 插件生成的服务端装箱任务。 */
export interface LayoutJob {
  /** 容器标识。 */
  id: string;
  /** 待装矩形。 */
  boxes: LayoutBox[];
  /** 每块的成员；整块平移保留内部叠放。 */
  members: Record<string, LayoutMember[]>;
  /** 块间距。 */
  gap: number;
  /** 水平边距。 */
  padX: number;
  /** 垂直边距。 */
  padY: number;
  /** 审计时要求至少缩小百分之三，否则沿用收紧方案。 */
  originalArea?: number;
  /** 不搬动时的收紧方案。 */
  fallback?: LayoutChange[];
}

/** 一次布局读写的传输结果。 */
export interface LayoutReply {
  /** 当前问题清单。 */
  issues: unknown[];
  /** 插件规划的普通修改。 */
  changes: LayoutChange[];
  /** 交给服务端的装箱任务。 */
  jobs: LayoutJob[];
  /** 由内向外的容器标识。 */
  containers: string[];
  /** 实际修改前后的属性，可按逆序回退。 */
  rollback: { before: LayoutChange; after: LayoutChange }[];
  /** 读取或写入失败；非空时不能宣称修净。 */
  errors: { id: string; message: string }[];
}
