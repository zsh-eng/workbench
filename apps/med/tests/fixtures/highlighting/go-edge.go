//go:build ignore

package edge

type pageBits [chunkPages / 64]uint64

func kind(n any, r rune) string {
	switch v := n.(type) {
	case *[]ast.Decl:
		return "decls"
	case interface {
		Set(x, y int, c color.RGBA64)
	}:
		return v.Name()
	}
	switch r {
	case 'a', '\n',
		'\x7f':
		return `raw
string`
	}
	return p.len() + 0x_1F_FF + 0b1_0i
}
