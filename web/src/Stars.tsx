const STAR = "M12 2.6l2.9 6.2 6.8.8-5 4.7 1.3 6.7L12 17.6 6 21l1.3-6.7-5-4.7 6.8-.8z";
const MAX = 4;

function Star({ fill, size }: { fill: number; size: number }) {
  // fill: 0 ~ 1，外框一定畫，實心部分依比例從左往右裁切
  return (
    <span className="star" style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
        <path d={STAR} className="star-outline" />
      </svg>
      {fill > 0 && (
        <span className="star-fill" style={{ width: `${fill * 100}%` }}>
          <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
            <path d={STAR} />
          </svg>
        </span>
      )}
    </span>
  );
}

/** 顯示分數（1~4，可以是小數，例如 3.4 會亮 3 顆加 0.4 顆） */
export function StarDisplay({ value, size = 20 }: { value: number; size?: number }) {
  return (
    <span className="stars" role="img" aria-label={`${value.toFixed(1)} 顆星（滿分 ${MAX}）`}>
      {Array.from({ length: MAX }, (_, i) => (
        <Star key={i} fill={Math.min(1, Math.max(0, value - i))} size={size} />
      ))}
    </span>
  );
}

/** 點選評分：點第 n 顆，前 n 顆都會亮起來 */
export function StarInput({
  value,
  onChange,
  labels,
  size = 36,
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  labels: readonly string[];
  size?: number;
}) {
  return (
    <span className="stars stars-input" role="radiogroup">
      {Array.from({ length: MAX }, (_, i) => (
        <button
          key={i}
          type="button"
          role="radio"
          aria-checked={value === i + 1}
          aria-label={`${i + 1} 顆星：${labels[i]}`}
          onClick={() => onChange(i + 1)}
        >
          <Star fill={value !== undefined && i < value ? 1 : 0} size={size} />
        </button>
      ))}
    </span>
  );
}
