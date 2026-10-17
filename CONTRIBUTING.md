# Contributing benchmarks

Results come in as pull requests from forks. Run a suite on your model, engine and
hardware, commit the run folder with a signed commit, and open a pull request. Once
it's merged, the run appears on [benchmarks.iammrduncan.com](https://benchmarks.iammrduncan.com)
with who submitted it and GitHub's verdict on the commit's signature.

## Add results

1. Fork this repository and clone your fork. Use Node 24 (`.nvmrc`), then run `npm ci`.
2. Run a suite with `bench`. The [runner README](runner/README.md) lists the targets
   (a recipe, a hosted model, or your own endpoint) and the suites. For example:

   ```sh
   npm run bench -- run --suite typed-decisions --tier quick \
     --endpoint http://127.0.0.1:8000 --identity identity.yaml --model <name>
   ```

   It writes `results/<subject>/<suite>/<run>/` with `run.json`, `raw.jsonl` and
   `summary.json`, and `subjects/<subject>/subject.yaml` for a new subject.
3. Check locally: `npm run check`, then
   `node runner/src/cli.ts summarize results --check`.
4. Commit only the new run folders (and the subject file) with a **signed**
   commit, push, and open a pull request.

## Sign your commits

The pull request check refuses results from commits that GitHub can't verify. SSH
signing is the quickest way to set it up:

```sh
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add the same public key on GitHub as a **signing key**: Settings → SSH and GPG
keys → New SSH key → Key type: *Signing Key*. Your commit email must be one of your
verified GitHub emails. GPG and S/MIME signatures work too; see
[GitHub's guide](https://docs.github.com/en/authentication/managing-commit-signature-verification).

Check it before you push: the pull request's commit list should show **Verified**.

## What the checks require

The `check` workflow runs on every pull request with a read-only token and no secrets:

- **Records validate.** Types, lint and tests pass, the site builds, and every
  `summary.json` recomputes byte for byte from its records.
- **Run folders are publishable.** Every file in a run folder is published on the
  site. The build refuses URL hosts that aren't loopback, a public domain or an
  alias, IP addresses or internal domains in URLs, `/Users/…` and `/home/…` paths,
  and hardware host names other than aliases (`gpu-host-N`, `cpu-host-N`). Name
  your machines by alias in your launcher inventory, and keep the real address in
  `address:`.
- **Signed results.** Every commit that adds files under `results/` carries a
  signature GitHub verifies.
- **No edits to `submissions/`.** After merge, the `record-submissions` workflow
  writes `submissions/<run>.json` from GitHub's own data: the pull request's
  author, the commit that added the run, and its signature verdict. The site shows
  these, so a pull request can't write them.

A signature proves who submitted a run, not that its numbers are right. Anyone can
rerun it, because `run.json` pins the model, quant, engine, harness commit and suite.

## New suites, categories and fixes

To propose a new suite or category, start with an issue or a pull request against
[docs/design](docs/design/README.md). A suite pins its dataset revision, item IDs,
prompt template and scorer, and has to agree with the official harness on a
reference subject before it is ranked. Fixes to the runner and the site can go
straight to a pull request.

Contributions are under the repository's [MIT license](LICENSE). Never commit API
keys, `.env` files or model weights.
