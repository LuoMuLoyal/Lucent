import { parse, type DocumentNode } from 'graphql';

/** `parse` 的等价物：把这个文件里的 SDL 字符串变成 DocumentNode。 */
function gql(strings: TemplateStringsArray): DocumentNode {
  return parse(strings.join(''));
}

/**
 * 药品关系图的 OGM schema。
 *
 * ## 为什么用 `@neo4j/graphql` 而不是裸 driver
 *
 * 图模型（节点标签、属性名、关系类型）在这里**声明一次**，查询与结果映射由 OGM
 * 统一处理；手写 Cypher 通过 `@cypher` 指令挂进来，仍然经 OGM 的 schema 与执行器
 * 运行。这样「图长什么样」只有一份事实源，而不是散落在每个查询的字符串里。
 *
 * ## 为什么查询全部走 `@cypher` 而不是声明式关系
 *
 * 这 9 个查询都是**多跳或带否定条件的图模式**：
 *
 * - 二跳 `A ─INHIBITS→ 酶 ←SUBSTRATE_OF─ B`；
 * - 4 跳级联（两个酶串联）；
 * - `NOT (...)` 反模式（替代候选要「不走这条酶」）；
 * - 最短路径（`shortestPath`）；
 * - 无向匹配（`INTERACTS_WITH` 在库中单向存储，见下）。
 *
 * 声明式的 `@relationship` 只能表达「取直接邻居」，上面这些要么表达不了、要么
 * 会退化成 N+1 次查询。`@cypher` 让 Cypher 保持一段完整的图模式，同时仍由 OGM
 * 负责 schema、参数与结果类型。
 *
 * ## ⚠️ 无向匹配不是笔误
 *
 * `INTERACTS_WITH` 在 Neo4j 里只存了**单向**的 2,534 条边；反向边本来是
 * `semantica-service` 的 `graph/orientation.py` 在**出图时**合成的，而 Lucent
 * 直连时走不到那条路径。所以凡涉及相互作用必须写 `-[r]-`（无向）：
 * 写成 `->` 会让「华法林与谁相互作用」返回 0 条，且看起来完全正常。
 */

/**
 * 节点类型。
 *
 * 属性名与图上的实际键一致（`drugbank_id` / `gene_name`），用 `@alias` 暴露成
 * 驼峰，避免 query 里到处出现下划线；`@query(read: false)` 在不需要按下标查询的
 * 类型上关掉自动生成的查询，schema 面保持最小。
 */
const nodeTypes = gql`
  type Drug @node(labels: ["Drug"]) {
    drugbankId: String @alias(property: "drugbank_id")
    name: String
    groups: String
    halfLife: String @alias(property: "half_life")
  }

  type Protein @node(labels: ["Protein"]) {
    id: String
    name: String
    geneName: String @alias(property: "gene_name")
  }

  type ATCClass @node(labels: ["ATCClass"]) {
    code: String
    name: String
  }
`;

/**
 * 查询结果类型。
 *
 * 这些是**投影**，不是图节点：它们没有 `@node`，不会被当作可写入的类型，
 * `@query(read: false)` 保证 OGM 不为其生成任何自动查询——它们的唯一入口是
 * 下面显式声明的 `@cypher` 字段。
 */
const resultTypes = gql`
  type MechanismPath {
    enzymeGene: String
    enzymeName: String
    otherDrugId: String
    otherDrugName: String
    relation: String
  }

  type SharedTarget {
    targetGene: String
    targetName: String
    drugCount: Int
    drugIds: [String]
    drugNames: [String]
  }

  type CascadePath {
    startDrug: String
    enzymeOne: String
    middleDrug: String
    enzymeTwo: String
    endDrug: String
  }

  type SubstituteCandidate {
    drugbankId: String
    name: String
    sharedTarget: String
  }

  type DrugAction {
    targetGene: String
    targetName: String
    relation: String
    actions: [String]
  }

  type ShortestRoute {
    stepCount: Int
    pathNodes: [String]
    pathRelations: [String]
  }

  type TargetDrug {
    drugbankId: String
    name: String
    relation: String
  }

  type TransportRoute {
    transporterGene: String
    transporterName: String
    inverted: Boolean
  }

  type EnzymeDuel {
    enzymeGene: String
    inducerDrug: String
    inhibitedSubstrate: String
  }
`;

/**
 * 9 个查询。
 *
 * 每个都带 `LIMIT`：`INHIBITS` × `SUBSTRATE_OF` 是笛卡尔积（`semantica-service`
 * 的 `reasoning_limits.py` 专门记录过它的组合爆炸），不封顶会把数据库和事件循环
 * 一起拖住。上限写在 Cypher 里，不依赖调用方传参——参数只能收窄，不能放大。
 */
/**
 * 9 个查询。
 *
 * ## `@cypher` 返回单个 map 而不是多列
 *
 * 列表字段上的 `@cypher` 需要 `columnName` 指向**一整行**，而不是其中某一列。
 * 写成 `RETURN a AS x, b AS y` + `columnName: "x"` 时查询**不报错但每行都是
 * null**——这是在真实图上跑通之前踩到的坑，schema 层单测发现不了。
 *
 * 正确形态是 `RETURN { 字段... } AS result` + `columnName: "result"`：
 * map 的键与 GraphQL 结果类型的字段名一一对应。
 *
 * ## 每个查询都带 `LIMIT`
 *
 * `INHIBITS` × `SUBSTRATE_OF` 是笛卡尔积（`semantica-service` 的
 * `reasoning_limits.py` 专门记录过它的组合爆炸），不封顶会把数据库和事件循环
 * 一起拖住。上限写在 Cypher 里，不依赖调用方传参——参数只能收窄，不能放大。
 */
const queryFields = gql`
  type Query {
    """
    方向一核心：两药之间经同一代谢酶形成的通路。
    形态：A ─INHIBITS/INDUCES→ 酶 ←SUBSTRATE_OF─ B
    """
    mechanismPaths(drugbankIds: [String!]!): [MechanismPath!]!
      @cypher(
        statement: """
        MATCH (a:Drug)-[rel]->(e:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
        WHERE a.drugbank_id IN $drugbankIds
          AND b.drugbank_id IN $drugbankIds
          AND a.drugbank_id <> b.drugbank_id
          AND type(rel) IN ['INHIBITS', 'INDUCES']
          AND e.gene_name IS NOT NULL
        RETURN {
          enzymeGene: e.gene_name,
          enzymeName: e.name,
          otherDrugId: b.drugbank_id,
          otherDrugName: b.name,
          relation: type(rel)
        } AS result
        LIMIT 300
        """
        columnName: "result"
      )

    """
    方向二：这组药共同作用的靶点（含药物数）。
    """
    sharedTargets(drugbankIds: [String!]!): [SharedTarget!]!
      @cypher(
        statement: """
        MATCH (d:Drug)-[r]->(t:Protein)
        WHERE d.drugbank_id IN $drugbankIds
          AND type(r) IN ['ACTS_ON', 'INHIBITS']
        WITH t, collect(DISTINCT d) AS drugs
        WHERE size(drugs) > 1
        RETURN {
          targetGene: coalesce(t.gene_name, t.name),
          targetName: t.name,
          drugCount: size(drugs),
          drugIds: [x IN drugs | x.drugbank_id],
          drugNames: [x IN drugs | x.name]
        } AS result
        LIMIT 100
        """
        columnName: "result"
      )

    """
    4 跳级联：A 抑制酶1 → C 是酶1底物且抑制酶2 → B 是酶2底物。
    这是「两药直接冲突」之外、只有图能表达的传播路径。
    """
    cascadePaths(startDrugbankId: String!): [CascadePath!]!
      @cypher(
        statement: """
        MATCH (a:Drug {drugbank_id: $startDrugbankId})-[:INHIBITS]->(e1:Protein)
              <-[:SUBSTRATE_OF]-(c:Drug)
        MATCH (c)-[:INHIBITS]->(e2:Protein)<-[:SUBSTRATE_OF]-(b:Drug)
        WHERE id(c) <> id(a) AND id(b) <> id(a) AND id(b) <> id(c)
          AND id(e1) <> id(e2)
        RETURN {
          startDrug: a.name,
          enzymeOne: e1.gene_name,
          middleDrug: c.name,
          enzymeTwo: e2.gene_name,
          endDrug: b.name
        } AS result
        LIMIT 100
        """
        columnName: "result"
      )

    """
    替代候选：不走指定酶、但作用于同一靶点的其他药物。
    返回的是**结构事实**，不是处方建议。
    """
    substituteCandidates(
      drugbankId: String!
      enzymeGene: String!
    ): [SubstituteCandidate!]!
      @cypher(
        statement: """
        MATCH (source:Drug {drugbank_id: $drugbankId})-[srel]->(target:Protein)
        WHERE type(srel) IN ['INHIBITS', 'ACTS_ON']
        MATCH (candidate:Drug)-[crel]->(target)
        WHERE type(crel) IN ['INHIBITS', 'ACTS_ON']
          AND candidate.drugbank_id <> source.drugbank_id
          AND NOT (candidate)-[:SUBSTRATE_OF]->(:Protein {gene_name: $enzymeGene})
          AND NOT (candidate)-[:INHIBITS]->(:Protein {gene_name: $enzymeGene})
        WITH DISTINCT candidate, target
        RETURN {
          drugbankId: candidate.drugbank_id,
          name: candidate.name,
          sharedTarget: target.gene_name
        } AS result
        LIMIT 50
        """
        columnName: "result"
      )

    """
    单药的作用谱：靶点 + 作用方式（方向一/二的共同入口）。
    """
    drugActions(drugbankId: String!): [DrugAction!]!
      @cypher(
        statement: """
        MATCH (d:Drug {drugbank_id: $drugbankId})-[r]->(t:Protein)
        WHERE type(r) IN ['INHIBITS', 'INDUCES', 'ACTS_ON', 'SUBSTRATE_OF']
        RETURN DISTINCT {
          targetGene: coalesce(t.gene_name, t.name),
          targetName: t.name,
          relation: type(r),
          actions: coalesce(r.actions, [])
        } AS result
        LIMIT 200
        """
        columnName: "result"
      )

    """
    两药在图上最短的传播路径（经过哪些节点、哪些关系）。
    """
    shortestRoute(
      fromDrugbankId: String!
      toDrugbankId: String!
    ): [ShortestRoute!]!
      @cypher(
        statement: """
        MATCH (a:Drug {drugbank_id: $fromDrugbankId}), (b:Drug {drugbank_id: $toDrugbankId})
        MATCH p = shortestPath((a)-[*..6]-(b))
        WHERE all(n IN nodes(p) WHERE n:Drug OR n:Protein)
        RETURN {
          stepCount: length(p),
          pathNodes: [n IN nodes(p) | coalesce(n.name, '')],
          pathRelations: [r IN relationships(p) | type(r)]
        } AS result
        LIMIT 20
        """
        columnName: "result"
      )

    """
    靶点视角：某靶点（基因名）上都有哪些药、各自什么作用。
    """
    targetDrugs(geneName: String!): [TargetDrug!]!
      @cypher(
        statement: """
        MATCH (d:Drug)-[r]->(t:Protein {gene_name: $geneName})
        WHERE type(r) IN ['INHIBITS', 'INDUCES', 'ACTS_ON', 'SUBSTRATE_OF']
        RETURN DISTINCT {
          drugbankId: d.drugbank_id,
          name: d.name,
          relation: type(r)
        } AS result
        LIMIT 300
        """
        columnName: "result"
      )

    """
    转运体视角：药物经某转运体（P-gp 等）外排或被摄取。
    inverted 为 true 表示边方向与「药物 → 转运体」相反，展示时不能画成同向箭头。
    """
    transportRoutes(drugbankId: String!): [TransportRoute!]!
      @cypher(
        statement: """
        MATCH (d:Drug {drugbank_id: $drugbankId})-[r]-(t:Protein)
        WHERE type(r) = 'TRANSPORTED_BY'
        RETURN {
          transporterGene: coalesce(t.gene_name, t.name),
          transporterName: t.name,
          inverted: startNode(r) <> d
        } AS result
        LIMIT 100
        """
        columnName: "result"
      )

    """
    酶诱导/抑制拮抗：A 诱导某酶、B 是该酶底物，两者对血药浓度的作用是相反的。
    这是「间接相互作用」里最容易被平铺表漏掉的一类。
    """
    enzymeDuel(drugbankIds: [String!]!): [EnzymeDuel!]!
      @cypher(
        statement: """
        MATCH (inducer:Drug)-[:INDUCES]->(e:Protein)<-[:SUBSTRATE_OF]-(substrate:Drug)
        WHERE inducer.drugbank_id IN $drugbankIds
          AND substrate.drugbank_id IN $drugbankIds
          AND inducer.drugbank_id <> substrate.drugbank_id
        RETURN {
          enzymeGene: e.gene_name,
          inducerDrug: inducer.name,
          inhibitedSubstrate: substrate.name
        } AS result
        LIMIT 100
        """
        columnName: "result"
      )
  }
`;

/** 完整 schema。顺序无关，OGM 会合并。 */
export const MEDICINE_GRAPH_TYPE_DEFS = [nodeTypes, resultTypes, queryFields];
