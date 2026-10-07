/** The engine without its device: sentence-transformers-torch-cuda -> sentence-transformers. */
export function engineFamily(name: string): string {
  return name.replace(/-(cuda|mps|xpu|cpu|rocm|openvino|metal)$/, '').replace(/-torch$/, '');
}
