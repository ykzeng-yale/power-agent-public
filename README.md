# Power Agent

Power Agent is a research workflow for statistical power and sample size planning. It takes a study question in JSON, records the proposed design and assumptions, runs R code, and returns a structured record with the result, executed code, and supporting evidence.

The single mode shares one model conversation for planning and analysis. The multi-agent mode uses separate conversations for planning, analysis, and review. Its reviewer runs a numerical check before seeing the analyst's code or artifacts. Both modes depend on the supplied study assumptions and model responses.

## Run an example

For model-generated R code, use the Linux container below. Its launcher starts R under an unprivileged identity and restricts worker networking. The runtime needs a provider API key and can make billable calls. Copy `.env.example` to `.env` and add your Anthropic API key. Tavily and Firecrawl keys are optional.

```sh
docker build -t power-agent .
docker run --rm -i --env-file .env power-agent --mode multi --no-search \
  < examples/scientific-request.json > record.json
```

Use `--mode single` for the shared conversation. The example uses synthetic inputs for a two-sample t test. The image uses R 4.4.1 and Node 20, with `jsonlite` 2.0.0, `pwr` 1.3-0, and `pmsampsize` 1.1.3. Add other R packages at image build time if a study requires them.

The standalone CLI has no npm runtime dependencies. With Node 20 or later, R, and `jsonlite` installed, `npm start -- --help` shows its options. The Linux worker requires a root launcher, Python 3, and libseccomp. The macOS path provides fresh processes and shares the host filesystem.

## Check the implementation

`npm test` exercises design input binding, model roles with a mock transport, R result serialization, and artifact capture. It uses local R and does not require API keys. The Linux identity isolation check applies on Linux.

## Source and benchmark

The CLI runtime is version 2.4.3. The eight runtime source files are copied verbatim from upstream commit `c55d189d76be238c204ed114736cd8cece5237ad`. This package includes the research workflow described in the manuscript. The hosted application has a separate implementation. The historical 106-task benchmark used an earlier system, and its recorded scores apply to that evaluation only.

The companion [106-task benchmark archive](https://github.com/ykzeng-yale/power-agent-benchmark-106) contains the benchmark questions and their archived reference answers.

The source code is available under the [MIT License](LICENSE). R packages retain their own licenses.
