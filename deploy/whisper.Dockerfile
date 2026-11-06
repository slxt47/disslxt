# Local speech recognition for voice messages (whisper.cpp). Runs without internet access.
FROM debian:bookworm-slim AS build
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git curl ca-certificates \
  && git clone --depth 1 --branch v1.9.5 https://github.com/ggml-org/whisper.cpp /src \
  && test "$(git -C /src rev-parse HEAD)" = "d2a764c648779feb36d44363f212a29b00aad1af" \
  && cmake -S /src -B /build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF \
  && cmake --build /build -j 4 --target whisper-server \
  && curl -fsSL -o /ggml-base.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin \
  && echo "465707469ff3a37a2b9b8d8f89f2f99de7299dac  /ggml-base.bin" | sha1sum -c -

FROM debian:bookworm-slim
COPY --from=build /build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /ggml-base.bin /models/ggml-base.bin
USER nobody
ENTRYPOINT ["whisper-server", "--model", "/models/ggml-base.bin", "--host", "0.0.0.0", "--port", "8080", "--threads", "4", "--language", "auto"]
