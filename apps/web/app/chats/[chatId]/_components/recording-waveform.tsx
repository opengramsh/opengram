type RecordingWaveformProps = {
  levels: number[];
};

export function RecordingWaveform({ levels }: RecordingWaveformProps) {
  return (
    <div className="flex h-8 items-center gap-[2px]">
      {levels.map((level, i) => (
        <div
          key={i}
          className="w-[3px] rounded-full bg-red-400 transition-[height] duration-75"
          style={{ height: `${Math.max(3, level * 32)}px` }}
        />
      ))}
    </div>
  );
}
