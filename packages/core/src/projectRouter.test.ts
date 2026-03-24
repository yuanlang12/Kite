import { beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'

// Mock fs and sessionManager before importing ProjectRouter
const mockExistsSync = mock(() => true)
const mockMkdirSync = mock(() => undefined)
const mockWriteFileSync = mock(() => undefined)
const mockReadFileSync = mock(() => '{"projects":{},"bindings":{}}')
const mockReaddirSync = mock(() => [])

mock.module('node:fs', () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  readFileSync: mockReadFileSync,
  readdirSync: mockReaddirSync,
}))

mock.module('./sessionManager.js', () => ({
  findLatestSessionId: mock(() => Promise.resolve(null)),
}))

const { ProjectRouter } = await import('./projectRouter.js')

describe('ProjectRouter', () => {
  let router: InstanceType<typeof ProjectRouter>

  beforeEach(() => {
    mockExistsSync.mockImplementation(() => true)
    mockReadFileSync.mockImplementation(() => '{"projects":{},"bindings":{}}')
    mockReaddirSync.mockImplementation(() => [])
    mockWriteFileSync.mockReset()
    router = new ProjectRouter('/tmp/test-project')
  })

  describe('resolve', () => {
    test('returns default project for unbound chat', () => {
      const route = router.resolve('telegram:123')
      expect(route.alias).toBe('default')
      expect(route.projectPath).toContain('test-project')
    })

    test('returns bound project after bind', () => {
      mockExistsSync.mockImplementation(() => true)
      router.addProject('myapp', '/tmp/myapp')
      router.bind('telegram:123', 'myapp')

      const route = router.resolve('telegram:123')
      expect(route.alias).toBe('myapp')
      expect(route.projectPath).toContain('myapp')
    })

    test('returns default after unbind', () => {
      router.addProject('myapp', '/tmp/myapp')
      router.bind('telegram:123', 'myapp')
      router.unbind('telegram:123')

      const route = router.resolve('telegram:123')
      expect(route.alias).toBe('default')
    })
  })

  describe('addProject', () => {
    test('adds a project successfully', () => {
      const result = router.addProject('web', '/tmp/web')
      expect(result.ok).toBe(true)
    })

    test('rejects reserved name "default"', () => {
      const result = router.addProject('default', '/tmp/something')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('reserved')
    })

    test('rejects non-existent path', () => {
      mockExistsSync.mockImplementation((p: string) => !String(p).includes('nonexistent'))
      const result = router.addProject('bad', '/tmp/nonexistent')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('not found')
    })
  })

  describe('removeProject', () => {
    test('removes an existing project', () => {
      router.addProject('myapp', '/tmp/myapp')
      const result = router.removeProject('myapp')
      expect(result.ok).toBe(true)
      expect(router.listProjects().find((p) => p.alias === 'myapp')).toBeUndefined()
    })

    test('cleans up bindings when removing project', () => {
      router.addProject('myapp', '/tmp/myapp')
      router.bind('telegram:123', 'myapp')
      router.removeProject('myapp')

      const route = router.resolve('telegram:123')
      expect(route.alias).toBe('default')
    })

    test('rejects removing default project', () => {
      const result = router.removeProject('default')
      expect(result.ok).toBe(false)
    })

    test('rejects removing unknown project', () => {
      const result = router.removeProject('nonexistent')
      expect(result.ok).toBe(false)
    })
  })

  describe('bind', () => {
    test('rejects binding to unknown project', () => {
      const result = router.bind('telegram:123', 'nonexistent')
      expect(result.ok).toBe(false)
      expect(result.error).toContain('Unknown project')
    })

    test('different chats can bind to different projects', () => {
      router.addProject('web', '/tmp/web')
      router.addProject('api', '/tmp/api')
      router.bind('telegram:1', 'web')
      router.bind('feishu:2', 'api')

      expect(router.resolve('telegram:1').alias).toBe('web')
      expect(router.resolve('feishu:2').alias).toBe('api')
    })
  })

  describe('listProjects / listBindings', () => {
    test('lists all projects including default', () => {
      router.addProject('web', '/tmp/web')
      const projects = router.listProjects()
      expect(projects.length).toBe(2) // default + web
    })

    test('lists bindings', () => {
      router.addProject('web', '/tmp/web')
      router.bind('telegram:1', 'web')
      const bindings = router.listBindings()
      expect(bindings).toEqual([{ chatKey: 'telegram:1', alias: 'web' }])
    })
  })

  describe('getBoundProjectPaths', () => {
    test('always includes default project', () => {
      const paths = router.getBoundProjectPaths()
      expect(paths.length).toBe(1)
    })

    test('includes bound project paths', () => {
      router.addProject('web', '/tmp/web')
      router.bind('telegram:1', 'web')
      const paths = router.getBoundProjectPaths()
      expect(paths.length).toBe(2)
    })
  })

  describe('persistence', () => {
    test('saves after addProject', () => {
      router.addProject('web', '/tmp/web')
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    test('saves after bind', () => {
      router.addProject('web', '/tmp/web')
      mockWriteFileSync.mockReset()
      router.bind('telegram:1', 'web')
      expect(mockWriteFileSync).toHaveBeenCalled()
    })
  })
})
