/* Browser camera lifecycle; opening a camera is always an explicit user action. */
class CameraSession {
  #getStream;
  #generation = 0;
  #stream = null;

  constructor(getStream) { this.#getStream = getStream; }
  get stream() { return this.#stream; }

  async open() {
    this.close();
    const generation = this.#generation;
    const stream = await this.#getStream();
    if (generation !== this.#generation) {
      for (const track of stream.getTracks()) track.stop();
      return null;
    }
    this.#stream = stream;
    return stream;
  }

  close() {
    this.#generation++;
    if (this.#stream) for (const track of this.#stream.getTracks()) track.stop();
    this.#stream = null;
  }
}
