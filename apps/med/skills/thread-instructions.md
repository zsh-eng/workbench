## Med

When `MED_THREAD_KEY` is set, Med started you in a thread. When a piece of work
is ready for review, run `med review create --working --title "<2-4 words>"
--guide -` with a JSON guide on standard input; the med skill and
`med docs agents` give the guide's format. In a checkout that other sessions
also change, add `--paths` with your files. Med sends the user's messages to
you as new turns, so do not run `med review wait`.
