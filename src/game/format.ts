export function formatTime(seconds: number): string {
  const whole = Math.floor(seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole % 60
  const hundredths = Math.floor((seconds - whole) * 100)
  const pad = (n: number) => (n < 10 ? '0' + n : '' + n)
  return minutes + ':' + pad(rest) + '.' + pad(hundredths)
}
