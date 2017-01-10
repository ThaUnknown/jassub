#! /bin/sh
set -e
cd "$(dirname "$0")"

usage() {
    echo "$0 [-f] [-c con_name] [-i img_name] [commmand [command_args...]]"
    echo "  -f: Skip building the container and reuse existing (\"fast\")"
    echo "  -c: Name of the container to create/use;"
    echo "      defaults to thaunknown_jassub-build"
    echo "  -i: Name of the image to buld/use;"
    echo "      defaults to thaunknown/jassub-build"
    echo "If no command is given `make` without arguments will be executed"
    exit 2
}

OPTIND=1
CONTAINER="thaunknown_jassub-build"
IMAGE="thaunknown/jassub-build"
FAST=0
while getopts "fc:s:" opt ; do
    case "$opt" in
        f) FAST=1 ;;
        c) CONTAINER="$OPTARG" ;;
        i) IMAGE="$OPTARG" ;;
        *) usage ;;
    esac
done

if [ "$OPTIND" -gt 1 ] ; then
    shift $(( OPTIND - 1 ))
fi

if [ "$FAST" -eq 0 ] ; then
    docker build -t "$IMAGE" .
fi
if [ "$#" -eq 0 ] ; then
    docker run -it --rm -v "${PWD}":/code --name "$CONTAINER" "$IMAGE":latest
else
    docker run -it --rm -v "${PWD}":/code --name "$CONTAINER" "$IMAGE":latest "$@"
fi
